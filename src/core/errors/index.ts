/**
 * Error mapping with remediation hints (E3-07, FR-E-010, FR-X-005, FR-X-006).
 *
 * toolError()        — produces MCP isError: true response
 * mapZodError()      — structured 4-part message from Zod validation failure
 * mapUpstreamError() — captures HTTP status + parses 422 body for field hints
 *
 * Story 6.6: every error result also carries `structuredContent` (operation, status,
 * upstreamCode, message, remediation incl. optional suggestedTool) alongside the
 * existing text — the SDK's validateToolOutput skips isError:true results entirely
 * (confirmed by reading its source), so this needs no outputSchema registration.
 */
import type { ZodError } from "zod";

export interface StructuredToolError {
  operation: string;
  /** Upstream HTTP status, when the failure came from an UpstreamHttpError. */
  status?: number;
  /** Upstream-supplied error code (e.g. body.code), when present. */
  upstreamCode?: string;
  message: string;
  remediation: {
    text: string;
    /** Name of a tool that would help resolve or work around this error, if any. */
    suggestedTool?: string;
  };
}

export interface ToolErrorOpts {
  operation: string;
  upstream: unknown;
  remediation: string;
  /** Story 6.6: surfaced in structuredContent.remediation.suggestedTool. */
  suggestedTool?: string;
}

export interface McpErrorContent {
  isError: true;
  content: [{ type: "text"; text: string }];
  structuredContent?: StructuredToolError;
}

export function toolError(opts: ToolErrorOpts): McpErrorContent {
  const upstreamMsg =
    opts.upstream instanceof Error ? opts.upstream.message : String(opts.upstream);
  const text = [
    `Operation ${opts.operation} failed: ${upstreamMsg}`,
    `Remediation: ${opts.remediation}`,
  ].join("\n");
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: {
      operation: opts.operation,
      ...(opts.upstream instanceof UpstreamHttpError ? { status: opts.upstream.status } : {}),
      ...(opts.upstream instanceof UpstreamHttpError && opts.upstream.code
        ? { upstreamCode: opts.upstream.code }
        : {}),
      message: upstreamMsg,
      remediation: {
        text: opts.remediation,
        ...(opts.suggestedTool ? { suggestedTool: opts.suggestedTool } : {}),
      },
    },
  };
}

/**
 * AC1: Zod validation failure → structured 4-part message.
 * Format: field | constraint | example | related tool
 */
export function mapZodError(err: ZodError): McpErrorContent {
  const parts = err.issues.map((issue) => {
    const field = issue.path.join(".") || "(root)";
    const constraint = issue.message;
    return `Field '${field}': ${constraint}`;
  });
  const text = `Input validation failed:\n${parts.join("\n")}`;
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: {
      operation: "input_validation",
      message: text,
      remediation: { text: "Fix the listed fields and retry." },
    },
  };
}

/** A per-field remediation hint: plain text, or text plus a tool that would help. */
export type RemediationHint = string | { text: string; suggestedTool?: string };

export interface UpstreamErrorOpts {
  operation: string;
  hints?: Record<string, RemediationHint>;
}

function hintText(hint: RemediationHint): string {
  return typeof hint === "string" ? hint : hint.text;
}

function hintSuggestedTool(hint: RemediationHint): string | undefined {
  return typeof hint === "string" ? undefined : hint.suggestedTool;
}

/**
 * AC2: Upstream HTTP error → MCP error with parsed 422 body.
 * AC4: 5xx → retry guidance. AC5: network failure → transient error.
 */
export function mapUpstreamError(err: unknown, opts?: UpstreamErrorOpts): McpErrorContent {
  const operation = opts?.operation ?? "unknown";

  if (err instanceof UpstreamHttpError) {
    const base = `Upstream error ${err.status} on ${operation}: ${err.message}`;
    const structuredBase: StructuredToolError = {
      operation,
      status: err.status,
      ...(err.code ? { upstreamCode: err.code } : {}),
      message: err.message,
      remediation: { text: "Review the error and retry." },
    };

    if (err.status === 422 && err.fieldErrors) {
      const fieldParts = Object.entries(err.fieldErrors).map(([field, hint]) => {
        const staticHint = opts?.hints?.[field];
        return `  ${field}: ${hint}${staticHint ? ` — ${hintText(staticHint)}` : ""}`;
      });
      // First field with a configured hint that names a tool wins the top-level suggestion.
      const suggestedTool = Object.keys(err.fieldErrors)
        .map((field) => (opts?.hints?.[field] ? hintSuggestedTool(opts.hints[field]) : undefined))
        .find((tool): tool is string => !!tool);
      return {
        isError: true,
        content: [{ type: "text", text: `${base}\nField issues:\n${fieldParts.join("\n")}` }],
        structuredContent: {
          ...structuredBase,
          remediation: {
            text: `Field issues: ${fieldParts.map((p) => p.trim()).join("; ")}`,
            ...(suggestedTool ? { suggestedTool } : {}),
          },
        },
      };
    }
    if (err.status >= 500) {
      const text = `${base}\nThis is a transient upstream error — retry after a few seconds.`;
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: {
          ...structuredBase,
          remediation: { text: "Transient upstream error — retry after a few seconds." },
        },
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: base }],
      structuredContent: structuredBase,
    };
  }

  // Network / unknown error (AC5)
  const msg = err instanceof Error ? err.message : "Unknown error communicating with upstream";
  const text = `Network error on ${operation}: ${msg}\nThis is a transient failure — retry in a moment.`;
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: {
      operation,
      message: msg,
      remediation: { text: "Transient network failure — retry in a moment." },
    },
  };
}

/** True when an error is an upstream HTTP 401 (used to drive auth refresh-retry, Story 2.2). */
export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof UpstreamHttpError && err.status === 401;
}

/**
 * Clear fail-soft error when an auth-requiring tool is called with no credentials
 * configured (Story 2.4). Returned before the tool executes — never a crash or a
 * confusing upstream 401.
 */
export function missingCredentialsError(operation: string): McpErrorContent {
  return toolError({
    operation,
    upstream: new Error("No credentials configured"),
    remediation:
      "Configure authentication before calling this tool — service account " +
      "(MCP_SVC_TOKEN_URL + MCP_SVC_CLIENT_ID + MCP_SVC_CLIENT_SECRET) or user credentials " +
      "(MCP_AUTH_EMAIL + MCP_AUTH_PASSWORD, or MCP_OPENID_*), then retry.",
  });
}

export function inferRemediation(err: unknown, hints: Record<string, string>): string {
  if (err instanceof UpstreamHttpError && err.fieldErrors) {
    const suggestions = Object.entries(err.fieldErrors)
      .map(([field]) => hints[field] ?? null)
      .filter(Boolean);
    if (suggestions.length > 0) return suggestions.join("; ");
  }
  return Object.values(hints)[0] ?? "Review the input fields and retry.";
}

export class UpstreamHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    /** Upstream-supplied error code (Story 6.6), e.g. `{code:'EvidenceCreateError'}`. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "UpstreamHttpError";
  }

  static async fromResponse(res: Response, operation: string): Promise<UpstreamHttpError> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return UpstreamHttpError.fromParsedError(res.status, body, operation);
  }

  /**
   * Story 10.2: `fromResponse` above requires an UNCONSUMED `Response` (it calls
   * `res.json()` itself). But by the time a generated tool's error branch runs
   * (`tool.ts.hbs`), Hey API's `@hey-api/client-fetch` has ALREADY consumed the
   * response body to populate `response.error` — the SDK function's return value is
   * `{ data, error, request, response }` where `response: Response`'s body stream is
   * spent, but `response.response.status` (no body read needed) and `response.error`
   * (the pre-parsed body) are both still available. This variant accepts an
   * ALREADY-PARSED body instead of a raw `Response` to parse itself — same field-error/
   * message/code extraction logic, just skipping the redundant (and impossible, on an
   * already-consumed stream) `res.json()` call.
   */
  static fromParsedError(status: number, body: unknown, operation: string): UpstreamHttpError {
    let fieldErrors: Record<string, string> | undefined;
    if (
      status === 422 &&
      body !== null &&
      typeof body === "object" &&
      "errors" in (body as object)
    ) {
      const errors = (body as { errors: unknown }).errors;
      if (typeof errors === "object" && errors !== null) {
        fieldErrors = {};
        for (const [k, v] of Object.entries(errors as Record<string, unknown>)) {
          fieldErrors[k] = Array.isArray(v) ? (v[0] as string) : String(v);
        }
      }
    }

    const message =
      typeof body === "object" && body !== null && "message" in (body as object)
        ? String((body as { message: unknown }).message)
        : `${operation} returned HTTP ${status}`;

    const code =
      typeof body === "object" && body !== null && "code" in (body as object)
        ? String((body as { code: unknown }).code)
        : undefined;

    return new UpstreamHttpError(status, message, fieldErrors, code);
  }
}
