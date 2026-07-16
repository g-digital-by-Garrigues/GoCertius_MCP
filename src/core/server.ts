/**
 * createServer() — wires all @suite/mcp-core ports into a runnable MCP server.
 * Used by every emitted product server entry point.
 *
 * Sync tools:
 *   1. Zod input validation → mapZodError on failure
 *   2. Idempotency check → return cached if within window
 *   3. Auth token (lazy — only if credentials configured)
 *   4. Execute tool with ToolContext, cache result
 *
 * Pollable tools (MCP Tasks, STR-E7-03):
 *   1. Zod input validation
 *   2. Auth token
 *   3. Create SDK Task via registerToolTask → return CreateTaskResult immediately
 *   4. Background: run tool + update task store via captured RequestTaskStore ref
 *   5. SSE bridge: upstream events update task state when available (E7)
 */

import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import { AuthConfigError, detectAuthAdapter } from "./auth/detect.js";
import { deviceFlowStore } from "./auth/device-flow.js";
import { createBearerIntrospector } from "./auth/introspect.js";
import { executeWithAuthRetry } from "./auth/retry.js";
import type { AuthSession } from "./auth/session.js";
import { createAuthSession } from "./auth/session.js";
import {
  toolError as buildToolError,
  inferRemediation,
  mapUpstreamError,
  mapZodError,
  missingCredentialsError,
} from "./errors/index.js";
import { createFileResolver, FileIngestionError } from "./files/index.js";
import { buildIdempotencyKeyHeader, IdempotencyCache } from "./idempotency.js";
import { createLogger } from "./logger.js";
import { withMetrics } from "./observability.js";
import type { SseEvent, TaskEventFilter, TerminalMatcher } from "./tasks/sse-bridge.js";
import {
  evidenceSealFilter,
  evidenceSealTerminal,
  extractCompanyIdFromJwt,
  notificationFilter,
  notificationTerminal,
  SseBridge,
  signatureRequestFilter,
  signatureRequestTerminal,
} from "./tasks/sse-bridge.js";
import type { PollConfig, PollStatusCheck } from "./tools/index.js";
import { type ToolContext, type ToolSpec, toolRequiresAuth } from "./tools/index.js";
import { HttpTransport } from "./transport/http.js";
import { httpRequestContext } from "./transport/request-context.js";
import { selectTransport } from "./transport/select.js";

export interface ServerConfig {
  name: string;
  version: string;
  tools: ToolSpec[];
}

interface SseBridgeToolConfig {
  filter: TaskEventFilter;
  terminal: TerminalMatcher;
  resultExtractor: (e: SseEvent) => unknown;
}

/** Per-tool SSE bridge wiring — returns null for tools without upstream SSE events. */
function getSseBridgeConfig(
  toolName: string,
  input: Record<string, unknown>,
): SseBridgeToolConfig | null {
  switch (toolName) {
    case "evidence_seal":
      return {
        filter: evidenceSealFilter(String(input.id ?? input.evidenceGroupId ?? "")),
        terminal: evidenceSealTerminal,
        resultExtractor: (e) => e.data,
      };
    case "notification_request_create":
    case "notification_request_send":
      return {
        filter: notificationFilter(String(input.id ?? input.notificationRequestId ?? "")),
        terminal: notificationTerminal,
        resultExtractor: (e) => e.data,
      };
    case "signature_request_create":
    case "signature_request_full_create":
      return {
        filter: signatureRequestFilter(String(input.id ?? input.requestId ?? "")),
        terminal: signatureRequestTerminal,
        resultExtractor: (e) => e.data,
      };
    default:
      return null;
  }
}

export async function createServer(config: ServerConfig): Promise<void> {
  const log = createLogger();
  const idempotency = new IdempotencyCache();
  // Process-wide, not per-session/per-request (Story 4.1): the SDK's InMemoryTaskStore is
  // itself session-agnostic (tasks are looked up by their own globally-unique taskId), so a
  // single shared instance keeps Tasks working across separate stateless HTTP requests.
  const taskStore = new InMemoryTaskStore();

  const preseededJwt = process.env.MCP_AUTH_JWT;
  if (preseededJwt) {
    deviceFlowStore.set(preseededJwt, Date.now() + 8 * 3_600_000);
    log.info("MCP_AUTH_JWT provided — pre-seeding auth session.");
  }

  let authSession: AuthSession | null = null;
  try {
    const adapter = detectAuthAdapter();
    if (adapter) authSession = createAuthSession(adapter);
  } catch (err) {
    if (err instanceof AuthConfigError) {
      log.error({ err }, `Auth config error: ${err.message}`);
    }
  }

  const BASE_URL = process.env.MCP_API_BASE_URL ?? "";

  // SSE bridge — connects lazily when first pollable task is registered (E7, STR-E7-01).
  // Persistence: MCP_BRIDGE_STATE_FILE env var (STR-E13-02); omit to disable.
  const sseBridge = new SseBridge(
    async () => {
      const token = await authSession?.getToken().catch(() => null);
      if (!token) return null;
      const companyId = extractCompanyIdFromJwt(token);
      if (!companyId) {
        log.warn(
          "SSE bridge: companyId not in JWT — SSE unavailable, background execution active.",
        );
        return null;
      }
      return `${BASE_URL}/notifications/sse/${encodeURIComponent(companyId)}`;
    },
    async () => {
      const token = await authSession?.getToken();
      return token ?? "";
    },
    process.env.MCP_BRIDGE_STATE_FILE,
    (toolName, filterKey) => getSseBridgeConfig(toolName, { id: filterKey }),
  );

  const transport = selectTransport();

  if (transport instanceof HttpTransport) {
    // Wire SSE bridge status into /healthz (STR-E8-03)
    transport.setSseStatusProvider(() => sseBridge.connectionStatus());

    // Inbound Bearer introspection (Story 2.3) — opt-in via MCP_SVC_INTROSPECT_URL.
    // Fail-soft: a misconfiguration logs and leaves introspection disabled; boot continues.
    try {
      const bearerVerifier = createBearerIntrospector();
      if (bearerVerifier) {
        transport.setBearerVerifier(bearerVerifier);
        log.info("Inbound Bearer introspection enabled (RFC 7662).");
      }
    } catch (err) {
      if (err instanceof AuthConfigError) {
        log.error({ err }, `Bearer introspection config error: ${err.message}`);
      } else {
        throw err;
      }
    }

    // Stateless mode (Story 4.1, ADR-A8 amended): a fresh McpServer is constructed and
    // connected for EVERY request (matching the MCP SDK's own stateless reference example),
    // sharing the process-wide taskStore/authSession/idempotency/sseBridge singletons.
    transport.setRequestHandlerFactory(async (reqTransport) => {
      const requestServer = new McpServer({ name: config.name, version: config.version }, {
        capabilities: {
          tasks: { requests: { tools: { call: {} } } },
        },
        taskStore,
      } as any);
      for (const tool of config.tools) {
        if (tool.pollable) {
          registerPollableTool(
            requestServer,
            tool,
            authSession,
            idempotency,
            sseBridge,
            log,
            config.name,
            config.version,
          );
        } else {
          registerSyncTool(
            requestServer,
            tool,
            authSession,
            idempotency,
            log,
            config.name,
            config.version,
          );
        }
      }
      // biome-ignore lint/suspicious/noExplicitAny: SDK transport type mismatch under exactOptionalPropertyTypes
      await requestServer.connect(reqTransport as any);
      return requestServer;
    });

    log.info({ transport: "http" }, `Starting ${config.name} v${config.version}`);
    await transport.start();

    process.on("SIGTERM", () => {
      sseBridge.stop();
      process.exit(0);
    });
  } else {
    const mcpServer = new McpServer({ name: config.name, version: config.version }, {
      capabilities: {
        tasks: { requests: { tools: { call: {} } } },
      },
      taskStore,
    } as any);
    for (const tool of config.tools) {
      if (tool.pollable) {
        registerPollableTool(
          mcpServer,
          tool,
          authSession,
          idempotency,
          sseBridge,
          log,
          config.name,
          config.version,
        );
      } else {
        registerSyncTool(
          mcpServer,
          tool,
          authSession,
          idempotency,
          log,
          config.name,
          config.version,
        );
      }
    }

    log.info({ transport: "stdio" }, `Starting ${config.name} v${config.version}`);
    await mcpServer.connect(transport);

    process.on("SIGTERM", async () => {
      sseBridge.stop();
      await mcpServer.close();
      process.exit(0);
    });
  }
}

// ── Sync tool ─────────────────────────────────────────────────────────────────

function registerSyncTool(
  mcpServer: McpServer,
  tool: ToolSpec,
  authSession: AuthSession | null,
  idempotency: IdempotencyCache,
  log: ReturnType<typeof createLogger>,
  pkg: string,
  version: string,
): void {
  const inputShape = extractZodShape(tool.inputSchema);

  mcpServer.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: inputShape,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      ...(tool.outputSchema ? { outputSchema: outputSchemaForRegister(tool.outputSchema) } : {}),
    },
    // biome-ignore lint/suspicious/noExplicitAny: registerTool's return-type overload narrows once outputSchema is set; SDK validates the real shape at runtime
    (async (rawArgs: any, _extra: any) => {
      const parseResult = tool.inputSchema.safeParse(rawArgs);
      if (!parseResult.success) return mapZodError(parseResult.error);
      const input = parseResult.data as unknown;

      const idempKey = IdempotencyCache.computeKey(tool.name, input as Record<string, unknown>);
      const cached = idempotency.get(tool.name, idempKey);
      if (cached) return cached as ReturnType<typeof buildMcpResult>;
      // ADR-A4-shaped key exposed to tools via ctx.getIdempotencyKey() (Story 4.5) —
      // distinct from idempKey above, which is the internal LRU cache key.
      const idempotencyKeyHeader = buildIdempotencyKeyHeader(pkg, version, tool.name, input);

      // HTTP mode: per-request JWT from Bearer header takes precedence over server auth
      const httpCtx = httpRequestContext.getStore();
      let auth = null;
      if (httpCtx?.jwt) {
        auth = { token: httpCtx.jwt, expiresAt: Number.POSITIVE_INFINITY };
      } else if (authSession && tool.name !== "session_login") {
        try {
          const token = await authSession.getToken();
          auth = { token, expiresAt: Date.now() + 3600_000 };
        } catch (err) {
          return buildToolError({
            operation: tool.name,
            upstream: err,
            remediation: "Check MCP_AUTH_* credentials in your server config.",
          });
        }
      }

      // Missing-credential fail-soft (Story 2.4): clear error instead of a confusing upstream 401.
      if (!auth && toolRequiresAuth(tool)) {
        return missingCredentialsError(tool.name);
      }

      // 401 refresh-retry-once: only for server-managed auth (not per-request Bearer, not session_login).
      const canRefresh = !httpCtx?.jwt && authSession !== null && tool.name !== "session_login";

      try {
        const transport = httpCtx ? "http" : "stdio";
        const result = await executeWithAuthRetry(
          (retryAuth) => {
            const ctx = buildToolContext(idempotencyKeyHeader, retryAuth, mcpServer, idempotency);
            return withMetrics(tool.name, () => tool.execute(input, ctx), {
              ...(tool.pollable !== undefined ? { pollable: tool.pollable } : {}),
              transport,
            });
          },
          auth,
          { authSession, canRefresh },
        );
        const mcpResult = buildMcpResult(result, tool.outputSchema !== undefined);
        idempotency.set(tool.name, idempKey, mcpResult, tool.idempotencyWindowSeconds);
        return mcpResult;
      } catch (err) {
        if (isMcpError(err)) return err as ReturnType<typeof buildMcpResult>;
        if (err instanceof FileIngestionError) return err.toMcpError();
        log.error({ tool: tool.name, err }, "Tool execution error");
        return mapUpstreamError(err, { operation: tool.name });
      }
    }) as any,
  );
}

// ── Pollable tool (MCP Tasks, STR-E7-03) ─────────────────────────────────────

// Exported for test coverage of the pollable registration path (Story 1.3 review, D1).
export function registerPollableTool(
  mcpServer: McpServer,
  tool: ToolSpec,
  authSession: AuthSession | null,
  idempotency: IdempotencyCache,
  sseBridge: SseBridge,
  log: ReturnType<typeof createLogger>,
  pkg: string,
  version: string,
): void {
  const inputShape = extractZodShape(tool.inputSchema);

  mcpServer.experimental.tasks.registerToolTask(
    tool.name,
    {
      description: tool.description,
      inputSchema: inputShape,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      ...(tool.outputSchema ? { outputSchema: outputSchemaForRegister(tool.outputSchema) } : {}),
      execution: { taskSupport: tool.taskSupport ?? "required" },
    },
    {
      // biome-ignore lint/suspicious/noExplicitAny: registerToolTask handler types are complex generic; SDK provides runtime safety
      createTask: async (rawArgs: any, extra: any) => {
        const parseResult = tool.inputSchema.safeParse(rawArgs);
        if (!parseResult.success) {
          throw new Error(mapZodError(parseResult.error).content[0].text);
        }
        const input = parseResult.data as Record<string, unknown>;

        // HTTP mode: per-request JWT takes precedence
        const httpCtx = httpRequestContext.getStore();
        let auth = null;
        if (httpCtx?.jwt) {
          auth = { token: httpCtx.jwt, expiresAt: Number.POSITIVE_INFINITY };
        } else if (authSession && tool.name !== "session_login") {
          const token = await authSession.getToken();
          auth = { token, expiresAt: Date.now() + 3600_000 };
        }

        // Missing-credential fail-soft (Story 2.4): clear error before creating a task.
        if (!auth && toolRequiresAuth(tool)) {
          throw new Error(missingCredentialsError(tool.name).content[0].text);
        }

        // Pollable-path idempotency (Story 1.3 review, D1): a task-unaware client whose
        // blocking tools/call timed out mid-poll (taskSupport "optional" holds the
        // response open for the whole composite) will retry with identical input.
        // Without this, every retry created a NEW task re-running the entire operation
        // (duplicate uploads / sealed groups). Replay within the tool's window returns
        // the SAME task — task-aware and task-unaware retries both converge on the
        // original task, whose result the SDK then serves from the shared taskStore.
        // Note: keyed by (tool, input) only — identity-agnostic, matching the sync
        // path's existing cache semantics.
        const replayKey = IdempotencyCache.computeKey(tool.name, input);
        const replayedTask = idempotency.get(tool.name, replayKey);
        if (replayedTask) {
          log.info(
            { tool: tool.name },
            "Pollable replay within idempotency window — returning the original task",
          );
          return { task: replayedTask };
        }

        // ADR-A4-shaped key exposed to tools via ctx.getIdempotencyKey() (Story 4.5).
        const ctx = buildToolContext(
          buildIdempotencyKeyHeader(pkg, version, tool.name, input),
          auth,
          mcpServer,
          idempotency,
        );

        // sseOnly tools wait for human action (signature, notification read) — use 7-day TTL.
        // Other pollable tools use 24h.
        const ttl = tool.sseOnly ? 7 * 86_400_000 : 86_400_000;
        // biome-ignore lint/suspicious/noExplicitAny: RequestTaskStore not exported from public SDK surface
        const task = await (extra.taskStore as any).createTask({ ttl });
        idempotency.set(tool.name, replayKey, task, tool.idempotencyWindowSeconds);
        // biome-ignore lint/suspicious/noExplicitAny: same as above
        const capturedStore: any = extra.taskStore;
        const taskId = task.taskId as string;

        // Register with SSE bridge if this tool has upstream events
        const bridgeCfg = getSseBridgeConfig(tool.name, input);
        if (bridgeCfg) {
          const filterKey = String(
            input.id ??
              input.requestId ??
              input.evidenceGroupId ??
              input.notificationRequestId ??
              taskId,
          );
          sseBridge.registerTask({
            taskId,
            toolName: tool.name,
            filterKey,
            ...bridgeCfg,
            onComplete: async (result) => {
              await safeStoreTaskResult(
                capturedStore,
                taskId,
                "completed",
                buildCallToolResultPayload(result, tool.outputSchema !== undefined),
                log,
                tool.name,
              );
              log.info({ tool: tool.name }, `SSE: task ${taskId} completed`);
            },
            onFail: async (error) => {
              await safeStoreTaskResult(
                capturedStore,
                taskId,
                "failed",
                buildErrorResultPayload(error),
                log,
                tool.name,
              );
              log.warn({ tool: tool.name }, `SSE: task ${taskId} failed — ${error}`);
            },
          });
        }

        if (tool.sseOnly && bridgeCfg) {
          // sseOnly: call the API to create the resource, but do NOT complete the task with the result.
          // Task stays in `working` — SSE bridge is the sole completion path (STR-E13-01).
          void tool.execute(input, ctx).catch((err) => {
            log.error({ tool: tool.name, err }, "sseOnly API call failed — task will not complete");
          });
        } else {
          // Non-sseOnly: run tool in background; SSE may arrive first (safeStoreTaskResult
          // tolerates the resulting already-terminal race). Degraded-polling (Story 5.2) only
          // kicks in when there's no SSE bridge for this tool — SSE is always preferred when
          // available, to avoid polling the upstream status endpoint needlessly.
          void executePollable(tool, input, ctx, taskId, capturedStore, log, bridgeCfg !== null);
        }

        return { task };
      },

      // biome-ignore lint/suspicious/noExplicitAny: same generic complexity
      getTask: async (_rawArgs: any, extra: any) => {
        return (extra.taskStore as any).getTask(extra.taskId);
      },

      // biome-ignore lint/suspicious/noExplicitAny: same
      getTaskResult: async (_rawArgs: any, extra: any) => {
        return (extra.taskStore as any).getTaskResult(extra.taskId);
      },
    },
  );
}

// ── Background execution ──────────────────────────────────────────────────────

export async function executePollable(
  tool: ToolSpec,
  input: Record<string, unknown>,
  ctx: ToolContext,
  taskId: string,
  // biome-ignore lint/suspicious/noExplicitAny: RequestTaskStore
  taskStore: any,
  log: ReturnType<typeof createLogger>,
  hasSseBridge: boolean,
): Promise<void> {
  try {
    const kickoff = await withMetrics(tool.name, () => tool.execute(input, ctx), {
      pollable: true,
      transport: ctx.correlationId ? "http" : "stdio",
    });

    // Degraded-polling fallback (ADR-A7, Story 5.2): only when there's no SSE bridge for
    // this tool (SSE is always preferred when available) and the tool declares how to
    // check the resource's status — poll it, bounded, instead of completing the task
    // immediately on the kickoff call's (likely non-terminal) response.
    if (!hasSseBridge && tool.pollForCompletion) {
      const final = await runBoundedPolling(
        tool.pollForCompletion(input, ctx, kickoff),
        log,
        tool.name,
      );
      if (final.status === "failed") {
        await safeStoreTaskResult(
          taskStore,
          taskId,
          "failed",
          buildErrorResultPayload(final.error ?? "Polling reported failure with no error detail."),
          log,
          tool.name,
        );
        return;
      }
      await safeStoreTaskResult(
        taskStore,
        taskId,
        "completed",
        buildCallToolResultPayload(final.result ?? kickoff, tool.outputSchema !== undefined),
        log,
        tool.name,
      );
      return;
    }

    await safeStoreTaskResult(
      taskStore,
      taskId,
      "completed",
      buildCallToolResultPayload(kickoff, tool.outputSchema !== undefined),
      log,
      tool.name,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ tool: tool.name, err }, `Pollable background error for task ${taskId}`);
    await safeStoreTaskResult(
      taskStore,
      taskId,
      "failed",
      buildErrorResultPayload(msg),
      log,
      tool.name,
    );
  }
}

/**
 * Bounded-polling degraded mode (ADR-A7, Story 5.2): calls `checkStatus()` on an interval
 * until it reports a terminal status, or gives up after `maxAttempts` and reports failure
 * (never blocks indefinitely — a task with no event source must still terminate).
 */
export async function runBoundedPolling(
  pollConfig: PollConfig,
  log: ReturnType<typeof createLogger>,
  toolName: string,
): Promise<PollStatusCheck> {
  const intervalMs = pollConfig.intervalMs ?? 5000;
  const maxAttempts = pollConfig.maxAttempts ?? 60;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const check = await pollConfig.checkStatus();
    if (check.status !== "pending") return check;
    log.info(
      { tool: toolName },
      `Degraded-polling attempt ${attempt}/${maxAttempts} for ${toolName} — still pending`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    status: "failed",
    error: `Polling timed out after ${maxAttempts} attempts (${(maxAttempts * intervalMs) / 1000}s) without reaching a terminal state.`,
  };
}

/**
 * Stores a task's terminal result, tolerating the race where the client already
 * cancelled the task (`tasks/cancel`) while this background execution or SSE callback
 * was still in flight. The SDK's InMemoryTaskStore throws on any write to an already-
 * terminal task; without this guard, that throw would surface as an unhandled promise
 * rejection (all callers here are fire-and-forget), which crashes the process under
 * Node's default unhandled-rejection policy. Any other error is re-logged as a genuine
 * failure. (Story 5.1)
 */
export async function safeStoreTaskResult(
  // biome-ignore lint/suspicious/noExplicitAny: RequestTaskStore not exported from public SDK surface
  taskStore: any,
  taskId: string,
  status: "completed" | "failed",
  payload: object,
  log: ReturnType<typeof createLogger>,
  toolName: string,
): Promise<void> {
  try {
    await taskStore.storeTaskResult(taskId, status, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("terminal status")) {
      log.info(
        { tool: toolName },
        `Task ${taskId} already terminal (likely client-cancelled) — dropping late ${status} result`,
      );
      return;
    }
    log.error({ tool: toolName, err }, `Failed to store ${status} result for task ${taskId}`);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildToolContext(
  idempotencyKeyHeader: string,
  auth: { token: string; expiresAt: number } | null,
  mcpServer: McpServer,
  idempotency: IdempotencyCache,
): ToolContext {
  const httpCtx = httpRequestContext.getStore();
  return {
    getIdempotencyKey: () => idempotencyKeyHeader,
    toolError: (opts) => {
      throw buildToolError(opts);
    },
    inferRemediation: (err, hints) => inferRemediation(err, hints),
    auth,
    files: createFileResolver({ transportMode: httpCtx ? "http" : "stdio" }),
    ...(httpCtx?.correlationId !== undefined ? { correlationId: httpCtx.correlationId } : {}),
    // biome-ignore lint/suspicious/noExplicitAny: ElicitRequestParams exactOptionalPropertyTypes mismatch
    elicitInput: async (params) => (await mcpServer.server.elicitInput(params as any)) as any,
  };
}

export function buildMcpResult(
  result: unknown,
  hasOutputSchema = false,
): {
  content: [{ type: "text"; text: string }];
  structuredContent?: object;
  isError?: boolean;
} {
  if (isMcpError(result)) {
    return result as { isError: true; content: [{ type: "text"; text: string }] };
  }
  return buildCallToolResultPayload(result, hasOutputSchema) as ReturnType<typeof buildMcpResult>;
}

/**
 * Builds a spec-compliant CallToolResult (Story 6.1, P-A5): when the tool declares an
 * `outputSchema`, the result is ALSO returned as `structuredContent` (required by the SDK's
 * `validateToolOutput` for schema-bearing tools) alongside the same JSON as `content` text —
 * never text+JSON.stringify as the *only* representation, per the architecture's anti-pattern
 * list. `content` always mirrors the structured value so clients that only read `content`
 * (pre-outputSchema convention) keep working unchanged.
 */
export function buildCallToolResultPayload(result: unknown, hasOutputSchema = false): object {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    ...(hasOutputSchema ? { structuredContent: result as object } : {}),
  };
}

function buildErrorResultPayload(error: unknown): object {
  const msg = typeof error === "string" ? error : String(error);
  return { isError: true, content: [{ type: "text", text: msg }] };
}

function isMcpError(val: unknown): boolean {
  return (
    val !== null &&
    typeof val === "object" &&
    "isError" in val &&
    (val as { isError: boolean }).isError === true
  );
}

/**
 * Every generated tool's `inputSchema` is always a `z.object({...})` (`tool.ts.hbs:13`),
 * but `outputSchema` can legitimately be a bare `z.array`/`z.record`/`z.intersection` at
 * the top level — Hey API infers these for several real EAD Factory response shapes
 * (list/search endpoints, free-form report responses, discriminated-union collections).
 * The MCP protocol's own `structuredContent` type is object-shaped (`Record<string,
 * unknown>` — never a bare array), so any non-`ZodObject` schema must be wrapped under a
 * named key for both what's advertised in `tools/list` AND the runtime value actually
 * returned — `buildMcpResult`'s `structuredContent: result` must be wrapped with the
 * SAME key the tool's `execute()` return value uses (see `tool.ts.hbs`'s
 * `outputSchemaIsObject`-gated return statement) or the SDK's `validateToolOutput`
 * throws `expected <inner>, received undefined` at the wrapper key, 100% of the time
 * (found via live EAD Factory testing, Story 10.1).
 */
export const NON_OBJECT_SCHEMA_WRAPPER_KEY = "data";

export function extractZodShape(schema: ToolSpec["inputSchema"]): ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return schema.shape as ZodRawShape;
  }
  return { [NON_OBJECT_SCHEMA_WRAPPER_KEY]: schema } as ZodRawShape;
}

/**
 * Story 6.1 (Live-Test Remediation Wave 2): recursively RELAX a response schema so the MCP
 * SDK's `validateToolOutput` accepts what the real upstream actually returns, while keeping
 * the STRUCTURE (keys, nesting, base types) for client documentation. Live testing of the
 * generated EAD Factory server against the INT gateway (2026-07-08) surfaced three ways the
 * vendored specs drift from reality, each of which hard-fails structuredContent with -32602:
 *   1. undeclared object keys — the generator injects `nextSteps` (FR-30) and the upstream
 *      returns fields beyond the spec → every object is made LOOSE (additionalProperties ok);
 *   2. strict string FORMATS — e.g. createdAt "2026-07-08T07:24:48.01275" (no timezone)
 *      fails `z.iso.datetime()` → every string is relaxed to a plain `z.string()`
 *      (datetime/uuid/email/regex constraints dropped);
 *   3. enum drift — an API that adds a status value the spec doesn't list would fail →
 *      string enums are relaxed to `z.string()`.
 * Numbers keep only their base type (bounds dropped); unknown node kinds fall back to
 * `z.unknown()`. This only touches OUTPUT schemas (inputs stay strict via `extractZodShape`),
 * and only ead-factory sets `emitOutputSchema: true`, so the blast radius is contained.
 */
export function relaxOutputSchema(schema: z.ZodType): z.ZodType {
  // biome-ignore lint/suspicious/noExplicitAny: Zod v4 internal def introspection
  const def = (schema as any)?._zod?.def;
  switch (def?.type) {
    case "object": {
      const shape = (schema as z.ZodObject).shape as Record<string, z.ZodType>;
      const relaxed: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries(shape)) relaxed[key] = relaxOutputSchema(value);
      return z.looseObject(relaxed);
    }
    case "array":
      return z.array(relaxOutputSchema(def.element));
    case "optional":
      return z.optional(relaxOutputSchema(def.innerType));
    case "nullable":
      return z.nullable(relaxOutputSchema(def.innerType));
    case "default":
    case "catch":
    case "readonly":
      // Output side: unwrap the modifier and treat as optional (the field may be absent).
      return z.optional(relaxOutputSchema(def.innerType));
    case "union":
      return z.union(
        (def.options as z.ZodType[]).map((opt) => relaxOutputSchema(opt)) as [
          z.ZodType,
          z.ZodType,
          ...z.ZodType[],
        ],
      );
    case "intersection":
      return z.intersection(relaxOutputSchema(def.left), relaxOutputSchema(def.right));
    case "record":
      return z.record(z.string(), relaxOutputSchema(def.valueType));
    case "string":
      return z.string(); // drop datetime/uuid/email/regex formats
    case "number":
      return z.number(); // drop int/min/max bounds
    case "boolean":
      return z.boolean();
    case "enum": {
      const entries = Object.values((def.entries ?? {}) as Record<string, unknown>);
      // String enums → plain string (accept drift). Non-string enums → fully permissive.
      return entries.every((v) => typeof v === "string") ? z.string() : z.unknown();
    }
    default:
      // literal / date / void / never / lazy / pipe / any / unknown / etc. → permissive.
      return z.unknown();
  }
}

/**
 * Builds the schema REGISTERED as a tool's `outputSchema`. For a top-level `ZodObject`,
 * returns the recursively-relaxed (and loose) object. For a non-`ZodObject` schema (bare
 * `z.array`/`z.record`/intersection/union), keeps Story 10.1's wrapper: the MCP protocol's
 * `structuredContent` is object-shaped, so the (relaxed) schema is advertised — and the value
 * returned — under `NON_OBJECT_SCHEMA_WRAPPER_KEY`. The SDK accepts a full Zod schema here
 * (`ZodRawShapeCompat | AnySchema`), not only a raw shape.
 */
export function outputSchemaForRegister(schema: ToolSpec["inputSchema"]): z.ZodType {
  if (schema instanceof z.ZodObject) {
    return relaxOutputSchema(schema);
  }
  return z.object({ [NON_OBJECT_SCHEMA_WRAPPER_KEY]: relaxOutputSchema(schema) });
}
