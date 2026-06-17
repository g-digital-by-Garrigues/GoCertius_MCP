/**
 * Tool registry + defineTool helper (E3-04, FR-E-001, FR-E-007, FR-E-013, ADR-02, ADR-14).
 *
 * defineTool() — typed factory; tool specs declared in emitted tool files
 * ToolRegistry  — collects tools; wired to McpServer at startup
 */
import type { ZodType } from "zod";
import type { AuthContext } from "../auth/session.js";
import type { McpErrorContent } from "../errors/index.js";

/**
 * MCP-spec tool annotations (https://modelcontextprotocol.io). These are
 * forwarded to the client so it can warn/confirm before risky operations.
 * Spec keys only — the pre-E13 keys (destructive/idempotent/requiresUserConfirmation)
 * were never sent to the client and are removed.
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool. */
  title?: string;
  /** Tool does not modify its environment (read-only). */
  readOnlyHint?: boolean;
  /** Tool may perform destructive/irreversible updates. Spec default is true; set false explicitly on non-destructive writes. */
  destructiveHint?: boolean;
  /** Calling repeatedly with the same args has no additional effect. */
  idempotentHint?: boolean;
  /** Tool interacts with an open world (e.g. the web). false = closed domain (this server's API). */
  openWorldHint?: boolean;
}

/** Minimal form-based elicitation params (avoids SDK import in tool files) */
export interface ElicitFormParams {
  mode?: "form";
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<
      string,
      | { type: "boolean"; title?: string; description?: string; default?: boolean }
      | { type: "string"; title?: string; description?: string; default?: string }
      | { type: "number" | "integer"; title?: string; description?: string; default?: number }
    >;
    required?: string[];
  };
}

/** URL-based elicitation params */
export interface ElicitUrlParams {
  mode: "url";
  message: string;
  elicitationId: string;
  url: string;
}

/** Result from elicitInput — action = "accept" means user submitted */
export interface ElicitResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

export interface ToolContext {
  /** Pre-computed idempotency key for this call */
  getIdempotencyKey(): string;
  /** Construct a structured MCP error (never returns — throws internally) */
  toolError(opts: { operation: string; upstream: unknown; remediation: string }): never;
  /** Suggest a remediation hint given upstream error + static hint map */
  inferRemediation(err: unknown, hints: Record<string, string>): string;
  /** Auth context (token for upstream API calls) — null if no credentials configured */
  auth: AuthContext | null;
  /** Per-request correlation ID for X-Correlation-Id header propagation (HTTP transport only) */
  correlationId?: string;
  /**
   * MCP elicitation — prompts the user via the client UI and waits for input.
   * Undefined when the client does not support elicitation.
   */
  elicitInput?: (params: ElicitFormParams | ElicitUrlParams) => Promise<ElicitResponse>;
}

export type ToolResult = unknown | McpErrorContent;

export interface ToolSpec<I extends ZodType = ZodType> {
  /** snake_case tool name (ADR-08) */
  name: string;
  /** ≥80 chars; summary + detail + when-to-use + prerequisites + cross-refs + example (FR-X-001) */
  description: string;
  /** Zod schema for input validation; fields must carry .describe() annotations (FR-X-002) */
  inputSchema: I;
  /** Tool metadata shown in tools/list (AC6) */
  annotations?: ToolAnnotations;
  /** True → returns CreateTaskResult; SSE bridge wired in E7 */
  pollable?: boolean;
  /**
   * When true, the executePollable fallback is suppressed for this tool.
   * The MCP task stays in `working` until the SSE bridge fires the terminal event.
   * Use for tools where the meaningful result is a future human action
   * (e.g. signature_request_create, notification_request_send).
   * Requires the tool to have an SSE bridge config in getSseBridgeConfig().
   * STR-E13-01
   */
  sseOnly?: boolean;
  /** Dedup window: 60s for sync, 86400 for pollable (NFR-R-004) */
  idempotencyWindowSeconds?: number;
  /** Tool implementation — called after auth + idempotency checks */
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * AC1: Typed factory — returns a fully-typed ToolSpec.
 * Used in every emitted tool file (see architecture §5.1).
 */
export function defineTool<I extends ZodType>(spec: ToolSpec<I>): ToolSpec<I> {
  return spec;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  /** AC2: Register a tool by name */
  register(tool: ToolSpec): void {
    this.tools.set(tool.name, tool);
  }

  /** AC2: List all registered tools */
  list(): ToolSpec[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  get size(): number {
    return this.tools.size;
  }
}

export const globalRegistry = new ToolRegistry();
