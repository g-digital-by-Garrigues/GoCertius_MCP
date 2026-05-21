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
import type { AuthSession } from "./auth/session.js";
import { createAuthSession } from "./auth/session.js";
import {
  toolError as buildToolError,
  inferRemediation,
  mapUpstreamError,
  mapZodError,
} from "./errors/index.js";
import { IdempotencyCache } from "./idempotency.js";
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
import type { ToolContext, ToolSpec } from "./tools/index.js";
import { HonoTransport } from "./transport/http.js";
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

  if (transport instanceof HonoTransport) {
    // Wire SSE bridge status into /healthz (STR-E8-03)
    transport.setSseStatusProvider(() => sseBridge.connectionStatus());

    // Per-session McpServer: each MCP client gets a fresh server instance (Bug 2 fix).
    // experimental.tasks capability advertised so clients can use callToolStream (Bug 3 fix).
    transport.setSessionFactory(async (sessionTransport) => {
      // biome-ignore lint/suspicious/noExplicitAny: McpServer capabilities type + taskStore under exactOptionalPropertyTypes
      const sessionServer = new McpServer({ name: config.name, version: config.version }, {
        capabilities: {
          experimental: { tasks: {} },
          tasks: { requests: { tools: { call: {} } } },
        },
        taskStore: new InMemoryTaskStore(),
      } as any);
      for (const tool of config.tools) {
        if (tool.pollable) {
          registerPollableTool(sessionServer, tool, authSession, idempotency, sseBridge, log);
        } else {
          registerSyncTool(sessionServer, tool, authSession, idempotency, log);
        }
      }
      // biome-ignore lint/suspicious/noExplicitAny: SDK transport type mismatch under exactOptionalPropertyTypes
      await sessionServer.connect(sessionTransport as any);
    });

    log.info({ transport: "http" }, `Starting ${config.name} v${config.version}`);
    await transport.start();

    process.on("SIGTERM", () => {
      sseBridge.stop();
      process.exit(0);
    });
  } else {
    // biome-ignore lint/suspicious/noExplicitAny: McpServer capabilities type + taskStore under exactOptionalPropertyTypes
    const mcpServer = new McpServer({ name: config.name, version: config.version }, {
      capabilities: {
        experimental: { tasks: {} },
        tasks: { requests: { tools: { call: {} } } },
      },
      taskStore: new InMemoryTaskStore(),
    } as any);
    for (const tool of config.tools) {
      if (tool.pollable) {
        registerPollableTool(mcpServer, tool, authSession, idempotency, sseBridge, log);
      } else {
        registerSyncTool(mcpServer, tool, authSession, idempotency, log);
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
): void {
  const inputShape = extractZodShape(tool.inputSchema);

  mcpServer.tool(tool.name, tool.description, inputShape, async (rawArgs, _extra) => {
    const parseResult = tool.inputSchema.safeParse(rawArgs);
    if (!parseResult.success) return mapZodError(parseResult.error);
    const input = parseResult.data as unknown;

    const idempKey = IdempotencyCache.computeKey(tool.name, input as Record<string, unknown>);
    const cached = idempotency.get(tool.name, idempKey);
    if (cached) return cached as ReturnType<typeof buildMcpResult>;

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

    const ctx = buildToolContext(idempKey, auth, mcpServer, idempotency);

    try {
      const transport = httpCtx ? "http" : "stdio";
      const result = await withMetrics(tool.name, () => tool.execute(input, ctx), {
        ...(tool.pollable !== undefined ? { pollable: tool.pollable } : {}),
        transport,
      });
      const mcpResult = buildMcpResult(result);
      idempotency.set(tool.name, idempKey, mcpResult, tool.idempotencyWindowSeconds);
      return mcpResult;
    } catch (err) {
      if (isMcpError(err)) return err as ReturnType<typeof buildMcpResult>;
      log.error({ tool: tool.name, err }, "Tool execution error");
      return mapUpstreamError(err, { operation: tool.name });
    }
  });
}

// ── Pollable tool (MCP Tasks, STR-E7-03) ─────────────────────────────────────

function registerPollableTool(
  mcpServer: McpServer,
  tool: ToolSpec,
  authSession: AuthSession | null,
  idempotency: IdempotencyCache,
  sseBridge: SseBridge,
  log: ReturnType<typeof createLogger>,
): void {
  const inputShape = extractZodShape(tool.inputSchema);

  mcpServer.experimental.tasks.registerToolTask(
    tool.name,
    {
      description: tool.description,
      inputSchema: inputShape,
      execution: { taskSupport: "required" },
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

        const ctx = buildToolContext(
          IdempotencyCache.computeKey(tool.name, input),
          auth,
          mcpServer,
          idempotency,
        );

        // sseOnly tools wait for human action (signature, notification read) — use 7-day TTL.
        // Other pollable tools use 24h.
        const ttl = tool.sseOnly ? 7 * 86_400_000 : 86_400_000;
        // biome-ignore lint/suspicious/noExplicitAny: RequestTaskStore not exported from public SDK surface
        const task = await (extra.taskStore as any).createTask({ ttl });
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
              // biome-ignore lint/suspicious/noExplicitAny: Result type construction
              await capturedStore.storeTaskResult(
                taskId,
                "completed",
                buildCallToolResultPayload(result) as any,
              );
              log.info({ tool: tool.name }, `SSE: task ${taskId} completed`);
            },
            onFail: async (error) => {
              // biome-ignore lint/suspicious/noExplicitAny: Result type construction
              await capturedStore.storeTaskResult(
                taskId,
                "failed",
                buildErrorResultPayload(error) as any,
              );
              log.warn({ tool: tool.name }, `SSE: task ${taskId} failed — ${error}`);
            },
          });
        }

        // sseOnly: task stays in `working` — SSE is the sole completion path (STR-E13-01).
        // Non-sseOnly: run tool in background; SSE may arrive first (SDK ignores duplicate storeTaskResult).
        if (!tool.sseOnly || !bridgeCfg) {
          void executePollable(tool, input, ctx, taskId, capturedStore, log);
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

async function executePollable(
  tool: ToolSpec,
  input: Record<string, unknown>,
  ctx: ToolContext,
  taskId: string,
  // biome-ignore lint/suspicious/noExplicitAny: RequestTaskStore
  taskStore: any,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  try {
    const result = await withMetrics(tool.name, () => tool.execute(input, ctx), {
      pollable: true,
      transport: ctx.correlationId ? "http" : "stdio",
    });
    // biome-ignore lint/suspicious/noExplicitAny: Result type construction
    await taskStore.storeTaskResult(taskId, "completed", buildCallToolResultPayload(result) as any);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ tool: tool.name, err }, `Pollable background error for task ${taskId}`);
    // biome-ignore lint/suspicious/noExplicitAny: Result type construction
    await taskStore.storeTaskResult(taskId, "failed", buildErrorResultPayload(msg) as any);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildToolContext(
  idempKey: string,
  auth: { token: string; expiresAt: number } | null,
  mcpServer: McpServer,
  idempotency: IdempotencyCache,
): ToolContext {
  const httpCtx = httpRequestContext.getStore();
  return {
    getIdempotencyKey: () => idempKey,
    toolError: (opts) => {
      throw buildToolError(opts);
    },
    inferRemediation: (err, hints) => inferRemediation(err, hints),
    auth,
    ...(httpCtx?.correlationId !== undefined ? { correlationId: httpCtx.correlationId } : {}),
    // biome-ignore lint/suspicious/noExplicitAny: ElicitRequestParams exactOptionalPropertyTypes mismatch
    elicitInput: async (params) => (await mcpServer.server.elicitInput(params as any)) as any,
  };
}

function buildMcpResult(result: unknown): {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
} {
  if (isMcpError(result)) {
    return result as { isError: true; content: [{ type: "text"; text: string }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

function buildCallToolResultPayload(result: unknown): object {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
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

function extractZodShape(schema: ToolSpec["inputSchema"]): ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return schema.shape as ZodRawShape;
  }
  return { _input: schema } as ZodRawShape;
}
