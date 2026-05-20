/**
 * Tool registry + defineTool helper (E3-04, FR-E-001, FR-E-007, FR-E-013, ADR-02, ADR-14).
 *
 * defineTool() — typed factory; tool specs declared in emitted tool files
 * ToolRegistry  — collects tools; wired to McpServer at startup
 */
import type { ZodType } from "zod";
import type { AuthContext } from "../auth/session.js";
import type { McpErrorContent } from "../errors/index.js";

export interface ToolAnnotations {
  /** Writes that cannot be undone (shown in Claude UI) */
  destructive?: boolean;
  /** Safe to call multiple times with same result */
  idempotent?: boolean;
  /** Prompts user before execution in clients that support it */
  requiresUserConfirmation?: boolean;
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
