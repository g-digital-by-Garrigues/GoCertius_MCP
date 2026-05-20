/**
 * Error mapping with remediation hints (E3-07, FR-E-010, FR-X-005, FR-X-006).
 *
 * toolError()        — produces MCP isError: true response
 * mapZodError()      — structured 4-part message from Zod validation failure
 * mapUpstreamError() — captures HTTP status + parses 422 body for field hints
 */
import type { ZodError } from "zod";

export interface ToolErrorOpts {
  operation: string;
  upstream: unknown;
  remediation: string;
}

export interface McpErrorContent {
  isError: true;
  content: [{ type: "text"; text: string }];
}

export function toolError(opts: ToolErrorOpts): McpErrorContent {
  const upstreamMsg =
    opts.upstream instanceof Error ? opts.upstream.message : String(opts.upstream);
  const text = [
    `Operation ${opts.operation} failed: ${upstreamMsg}`,
    `Remediation: ${opts.remediation}`,
  ].join("\n");
  return { isError: true, content: [{ type: "text", text }] };
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
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Input validation failed:\n${parts.join("\n")}`,
      },
    ],
  };
}

export interface UpstreamErrorOpts {
  operation: string;
  hints?: Record<string, string>;
}

/**
 * AC2: Upstream HTTP error → MCP error with parsed 422 body.
 * AC4: 5xx → retry guidance. AC5: network failure → transient error.
 */
export function mapUpstreamError(err: unknown, opts?: UpstreamErrorOpts): McpErrorContent {
  const operation = opts?.operation ?? "unknown";

  if (err instanceof UpstreamHttpError) {
    const base = `Upstream error ${err.status} on ${operation}: ${err.message}`;
    if (err.status === 422 && err.fieldErrors) {
      const fieldParts = Object.entries(err.fieldErrors)
        .map(([field, hint]) => {
          const staticHint = opts?.hints?.[field];
          return `  ${field}: ${hint}${staticHint ? ` — ${staticHint}` : ""}`;
        })
        .join("\n");
      return {
        isError: true,
        content: [{ type: "text", text: `${base}\nField issues:\n${fieldParts}` }],
      };
    }
    if (err.status >= 500) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `${base}\nThis is a transient upstream error — retry after a few seconds.`,
          },
        ],
      };
    }
    return { isError: true, content: [{ type: "text", text: base }] };
  }

  // Network / unknown error (AC5)
  const msg = err instanceof Error ? err.message : "Unknown error communicating with upstream";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Network error on ${operation}: ${msg}\nThis is a transient failure — retry in a moment.`,
      },
    ],
  };
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

    let fieldErrors: Record<string, string> | undefined;
    if (
      res.status === 422 &&
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
        : `${operation} returned HTTP ${res.status}`;

    return new UpstreamHttpError(res.status, message, fieldErrors);
  }
}
