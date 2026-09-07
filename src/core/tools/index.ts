/**
 * Tool registry + defineTool helper (E3-04, FR-E-001, FR-E-007, FR-E-013, ADR-02, ADR-14).
 *
 * defineTool() — typed factory; tool specs declared in emitted tool files
 * ToolRegistry  — collects tools; wired to McpServer at startup
 */

import type { ZodType } from "zod";
import { z } from "zod";
import type { AuthContext } from "../auth/session.js";
import type { McpErrorContent } from "../errors/index.js";
import type { FileResolver } from "../files/index.js";

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
  /** ADR-A4-shaped idempotency key for this call: `<pkg>/<version>/<tool>/<sha256(input)>` (Story 4.5). */
  getIdempotencyKey(): string;
  /** Construct a structured MCP error (never returns — throws internally) */
  toolError(opts: { operation: string; upstream: unknown; remediation: string }): never;
  /** Suggest a remediation hint given upstream error + static hint map */
  inferRemediation(err: unknown, hints: Record<string, string>): string;
  /** Auth context (token for upstream API calls) — null if no credentials configured */
  auth: AuthContext | null;
  /** Hardened file ingestion — tools resolve FileInput here, never reading the FS/URLs directly (ADR-A3). */
  files: FileResolver;
  /** Per-request correlation ID for X-Correlation-Id header propagation (HTTP transport only) */
  correlationId?: string;
  /**
   * MCP elicitation — prompts the user via the client UI and waits for input.
   * Undefined when the client does not support elicitation.
   */
  elicitInput?: (params: ElicitFormParams | ElicitUrlParams) => Promise<ElicitResponse>;
  /**
   * Force the server's shared `AuthSession` to re-exchange its credential, and
   * return the resulting context — the fresh token plus its `expiresAt` (epoch ms),
   * so the caller can use the token immediately (e.g. for `GET /profile`) without a
   * second exchange.
   *
   * The shared `AuthSession` — not the tool — owns the token. This delegates to the
   * very instance every other tool call is served from, so its single-flight guard,
   * its in-memory cache and `jwtExpiryMs`'s expiry clamp all still apply, and the
   * token it mints is the one subsequent calls will use. A tool must never mint or
   * store a session token of its own.
   *
   * Why a tool needs this at all (STR-E18-02): `session_login` declares
   * `operatesOnServerSession`, which excludes it from token injection in `server.ts`
   * (STR-E18-04 replaced the older by-name exclusion), so it executes with
   * `auth === null`. It used to reach the process session by writing its own exchange
   * into the in-process token store, which was deleted along with the pre-seeded-JWT
   * path — so this is now the only way a tool can affect the session the server
   * actually uses.
   *
   * Undefined when there is no session to act on: a credential-less boot
   * (`detectAuthAdapter` returned null, FR-E-013), or HTTP mode where the caller
   * brought its own Bearer and the server owns no session.
   *
   * That is a PER-CALL answer. STR-E18-04 adds a separate, deployment-level one on top:
   * when `MCP_HTTP_PUBLIC=true` a tool declaring `operatesOnServerSession` is never
   * registered, so the question is not asked at all. The two layers answer different
   * questions — "may this particular call act on a server session" versus "should this
   * deployment advertise such a tool in the first place".
   */
  reauthenticate?: () => Promise<AuthContext>;
}

export type ToolResult = unknown | McpErrorContent;

/** Outcome of a single degraded-polling status check (Story 5.2). */
export interface PollStatusCheck {
  status: "pending" | "completed" | "failed";
  /** Present when status is 'completed' — becomes the task's terminal result. */
  result?: unknown;
  /** Present when status is 'failed' — becomes the task's terminal error message. */
  error?: string;
}

/**
 * Bounded-polling degraded mode (ADR-A7, Story 5.2): used by pollable tools that have
 * no upstream SSE bridge config (see `getSseBridgeConfig` in server.ts). After the
 * tool's initial `execute()` kicks off the async upstream operation, mcp-core calls
 * `checkStatus()` on an interval until it reports a terminal status, then completes/
 * fails the MCP Task accordingly — replacing the legacy pattern of the *agent*
 * manually re-calling a status tool in a loop (see e.g. `evidence_seal`'s description).
 */
export interface PollConfig {
  checkStatus: () => Promise<PollStatusCheck>;
  /** Milliseconds between checks. Default 5000. */
  intervalMs?: number;
  /** Maximum checks before giving up (task fails with a timeout error). Default 60 (~5 min at the default interval). */
  maxAttempts?: number;
}

export interface ToolSpec<I extends ZodType = ZodType> {
  /** snake_case tool name (ADR-08) */
  name: string;
  /**
   * Marks a composite tool that orchestrates multiple upstream calls in the domain
   * layer and returns a single result (P-A4, Story 6.3). Omitted/undefined = atomic
   * (the default — one tool, one upstream operation). Consumed by n8n reconciliation
   * (ADR-A6, Epic 8): a workflow tool must be either `n8nExclude: true` or mapped to
   * exactly one n8n operation, never inferred.
   */
  kind?: "workflow";
  /** ≥80 chars; summary + detail + when-to-use + prerequisites + cross-refs + example (FR-X-001) */
  description: string;
  /** Zod schema for input validation; fields must carry .describe() annotations (FR-X-002) */
  inputSchema: I;
  /**
   * Zod schema for the tool's structured result (P-A5, Story 6.1). When set, every
   * result also carries `structuredContent` (validated by the SDK against this schema)
   * alongside the existing JSON-text `content` — replacing the legacy
   * text-blob-+-`JSON.stringify`-only pattern the architecture explicitly forbids.
   * `execute()`'s return value is used as-is for `structuredContent`; it must match
   * this schema's shape. Optional: tools without one keep today's text-only behavior.
   */
  outputSchema?: ZodType;
  /** Tool metadata shown in tools/list (AC6) */
  annotations?: ToolAnnotations;
  /** True → returns CreateTaskResult; SSE bridge wired in E7 */
  pollable?: boolean;
  /**
   * MCP task-augmentation requirement for pollable tools (ignored otherwise). Default
   * 'required': only task-aware clients can call the tool (a plain `tools/call` gets
   * MethodNotFound). 'optional' lets the SDK (mcp.js `handleAutomaticTaskPolling`)
   * transparently create the task and poll it to completion for clients that don't
   * request task augmentation, returning a normal synchronous CallToolResult.
   * Use 'optional' ONLY for bounded-duration ops (seconds/minutes) — the SDK's polling
   * loop blocks the `tools/call` response for as long as the task runs, with no
   * timeout, which is unsafe for ops that can take minutes-to-days (e.g. a signature
   * flow waiting on a human signer): that would hold the HTTP connection open
   * indefinitely and hit client/proxy timeouts. (Story 5.1)
   */
  taskSupport?: "required" | "optional";
  /**
   * When true, the executePollable fallback is suppressed for this tool.
   * The MCP task stays in `working` until the SSE bridge fires the terminal event.
   * Use for tools where the meaningful result is a future human action
   * (e.g. signature_request_create, notification_request_send).
   * Requires the tool to have an SSE bridge config in getSseBridgeConfig().
   * STR-E13-01
   */
  sseOnly?: boolean;
  /**
   * Degraded-polling fallback (ADR-A7, Story 5.2) for pollable tools with no SSE bridge
   * config. Called once, right after `execute()`'s kickoff call returns, with the same
   * `input`/`ctx` PLUS `execute()`'s own return value (Story 6.3 addition — a composite
   * tool that creates the polled resource itself, e.g. `evidence_create_sealed` creating
   * an evidence group, only learns the resource's id from its own kickoff result, not from
   * the original input); mcp-core polls the returned `PollConfig.checkStatus()` on a
   * bounded interval until terminal, then completes/fails the Task. Ignored for sync
   * tools, for `sseOnly` tools (SSE is the sole completion path there), and for tools that
   * DO have an SSE bridge config (SSE is preferred — this is the fallback for when it's
   * absent).
   */
  pollForCompletion?: (input: unknown, ctx: ToolContext, kickoffResult: unknown) => PollConfig;
  /** Dedup window: 60s for sync, 86400 for pollable (NFR-R-004) */
  idempotencyWindowSeconds?: number;
  /**
   * Whether this tool needs an upstream token. Default true. Set false for
   * bootstrap/meta tools that need no credential at all (e.g. a help tool). Drives
   * the missing-credential fail-soft guard (see `toolRequiresAuth`).
   *
   * Independent of `operatesOnServerSession` below, and neither implies the other:
   * this one says "no credential is needed"; that one says "the credential is this
   * tool's subject rather than its input".
   */
  requiresAuth?: boolean;
  /**
   * Declares that the tool operates ON the server's own credential session instead of
   * consuming it. `session_login` — "make the server re-exchange its configured
   * credential" — is the only such tool today (STR-E18-04).
   *
   * mcp-core used to express exactly this by comparing `tool.name` against the literal
   * tool name session_login in four separate places, which put a product tool name
   * inside a product-agnostic package. This flag replaces all four; each one is a
   * different consequence of the same statement:
   *
   *  - **No token injection.** `server.ts` does not put the server's token into
   *    `ctx.auth`: the tool's job is to (re-)establish that token, so handing it the
   *    stale one is meaningless. It reaches the session via `ctx.reauthenticate`.
   *  - **No 401 refresh-and-retry.** The generic one-shot retry would re-exchange the
   *    credential and then re-run a tool whose entire purpose is that exchange.
   *  - **No missing-credentials fail-soft.** See `toolRequiresAuth`: the tool has to be
   *    callable precisely when the session is not usable yet.
   *  - **Not registered at all in shared HTTP mode.** With `MCP_HTTP_PUBLIC=true` the
   *    server is multi-tenant: every caller brings its own `Authorization: Bearer`
   *    token and the server holds no session on anyone's behalf, so the tool has
   *    nothing to act on — and if the operator did configure a server-side credential,
   *    calling it would authenticate as the OPERATOR and return the operator's identity
   *    to whichever client asked. `server.ts` therefore withholds flagged tools from
   *    registration (and so from `tools/list`) in that mode.
   */
  operatesOnServerSession?: boolean;
  /** Tool implementation — called after auth + idempotency checks */
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * True when a tool must have auth available before executing. Default-true, with two
 * INDEPENDENT opt-outs:
 *   - `requiresAuth: false` — the tool needs no credential at all (e.g. a help tool);
 *   - `operatesOnServerSession: true` — establishing the credential IS the tool's job,
 *     so it must stay callable while there is none.
 *
 * The second replaces the hardcoded by-name exemption for session_login that this
 * function used to carry, whose own comment called it "a back-compat name exemption":
 * a product tool name had no business in product-agnostic mcp-core (STR-E18-04).
 */
export function toolRequiresAuth(
  tool: Pick<ToolSpec, "name" | "requiresAuth" | "operatesOnServerSession">,
): boolean {
  return tool.requiresAuth !== false && tool.operatesOnServerSession !== true;
}

/**
 * AC1: Typed factory — returns a fully-typed ToolSpec.
 * Used in every emitted tool file (see architecture §5.1).
 */
export function defineTool<I extends ZodType>(spec: ToolSpec<I>): ToolSpec<I> {
  return spec;
}

/**
 * Enriches a Zod object schema's fields with descriptions from a name -> text glossary
 * (Story 6.5, FR-27/P-A5). Generated tool files for a product that opts in
 * (`ProductConfig.commonFieldGlosses`) call this on their `inputSchema` so commonly
 * reused field names (e.g. `caseFileId`, `evidenceGroupId`) get a consistent, useful
 * description everywhere they appear, without every generated file needing its own
 * per-field authoring. A field's own explicit `.describe()` always wins — this only
 * fills in fields that don't already carry one. No-op for non-object schemas or
 * schemas with no matching field names.
 */
export function applyFieldGlosses<T extends ZodType>(
  schema: T,
  glosses: Record<string, string>,
): T {
  if (!(schema instanceof z.ZodObject)) return schema;
  const shape = schema.shape as Record<string, ZodType>;
  const extension: Record<string, ZodType> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const gloss = glosses[key];
    if (!gloss || fieldSchema.description) continue;
    extension[key] = fieldSchema.describe(gloss);
  }
  if (Object.keys(extension).length === 0) return schema;
  // biome-ignore lint/suspicious/noExplicitAny: ZodObject.extend's generic shape typing can't express a dynamically-keyed partial extension
  return (schema as any).extend(extension) as T;
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
