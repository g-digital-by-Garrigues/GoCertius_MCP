/**
 * createServer() — wires all @suite/mcp-core ports into a runnable MCP server.
 * Used by every emitted product server entry point.
 *
 * Pipeline per tool call:
 *   1. Zod input validation → mapZodError on failure
 *   2. Idempotency check → return cached if within window
 *   3. Auth token (lazy — only if credentials configured)
 *   4. Execute tool with ToolContext
 *   5. Cache result, return
 */
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
import { generateTaskId, taskStore } from "./tasks/index.js";
import type { ToolContext, ToolSpec } from "./tools/index.js";
import { HonoTransport } from "./transport/http.js";
import { selectTransport } from "./transport/select.js";

export interface ServerConfig {
  name: string;
  version: string;
  tools: ToolSpec[];
}

export async function createServer(config: ServerConfig): Promise<void> {
  const log = createLogger();
  const idempotency = new IdempotencyCache();

  // MCP_AUTH_JWT: pre-seed the device flow store with a known JWT (e.g. extracted from browser).
  // This bypasses the full auth flow — the JWT is used directly for all tool calls.
  const preseededJwt = process.env.MCP_AUTH_JWT;
  if (preseededJwt) {
    deviceFlowStore.set(preseededJwt, Date.now() + 8 * 3_600_000); // 8 h validity assumption
    log.info("MCP_AUTH_JWT provided — pre-seeding auth session.");
  }

  // Auth: lazy — null if no credentials configured (FR-E-013)
  let authSession: AuthSession | null = null;
  try {
    const adapter = detectAuthAdapter();
    if (adapter) authSession = createAuthSession(adapter);
  } catch (err) {
    if (err instanceof AuthConfigError) {
      log.error({ err }, `Auth config error: ${err.message}`);
    }
    // Boot continues without auth — tools/list still works
  }

  const mcpServer = new McpServer({
    name: config.name,
    version: config.version,
  });

  // Register each tool with middleware chain
  for (const tool of config.tools) {
    // Build the JSON schema shape for this tool (McpServer expects ZodRawShape)
    // We use the tool's inputSchema directly since McpServer supports ZodType
    const inputShape = extractZodShape(tool.inputSchema);

    mcpServer.tool(tool.name, tool.description, inputShape, async (rawArgs, _extra) => {
      // 1. Validate input
      const parseResult = tool.inputSchema.safeParse(rawArgs);
      if (!parseResult.success) {
        return mapZodError(parseResult.error);
      }
      const input = parseResult.data as unknown;

      // 2. Idempotency check
      const idempKey = IdempotencyCache.computeKey(tool.name, input as Record<string, unknown>);
      const cached = idempotency.get(tool.name, idempKey);
      if (cached) return cached as ReturnType<typeof buildMcpResult>;

      // 3. Auth (lazy) — skipped for session_login so it can bootstrap device flow
      let auth = null;
      if (authSession && tool.name !== "session_login") {
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

      // 4. Build context
      const ctx: ToolContext = {
        getIdempotencyKey: () => idempKey,
        toolError: (opts) => {
          throw buildToolError(opts);
        },
        inferRemediation: (err, hints) => inferRemediation(err, hints),
        auth,
        // Wire elicitation through the underlying Server instance
        // biome-ignore lint/suspicious/noExplicitAny: SDK ElicitRequestParams ↔ our subset types; content optionality differs under exactOptionalPropertyTypes
        elicitInput: async (params) =>
          (await mcpServer.server.elicitInput(params as any)) as any,
      };

      // 5. Execute
      try {
        if (tool.pollable) {
          const taskId = generateTaskId();
          const taskEntry = taskStore.create(taskId);
          // Run in background
          void executeInBackground(tool, input, ctx, authSession, taskId, idempotency);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ taskId: taskEntry.taskId, status: "running" }),
              },
            ],
          };
        }

        const result = await tool.execute(input, ctx);
        const mcpResult = buildMcpResult(result);
        idempotency.set(tool.name, idempKey, mcpResult, tool.idempotencyWindowSeconds);
        return mcpResult;
      } catch (err) {
        if (
          err !== null &&
          typeof err === "object" &&
          "isError" in err &&
          (err as { isError: boolean }).isError
        ) {
          return err as ReturnType<typeof buildMcpResult>;
        }
        log.error({ tool: tool.name, err }, "Tool execution error");
        return mapUpstreamError(err, { operation: tool.name });
      }
    });
  }

  // Start transport
  const transport = selectTransport();
  log.info(
    { transport: transport instanceof HonoTransport ? "http" : "stdio" },
    `Starting ${config.name} v${config.version}`,
  );

  if (transport instanceof HonoTransport) {
    // biome-ignore lint/suspicious/noExplicitAny: StreamableHTTPServerTransport implements Transport but exactOptionalPropertyTypes causes mismatch
    await mcpServer.connect(transport.sdkTransport as any);
    await transport.start();
  } else {
    await mcpServer.connect(transport);
  }

  // Graceful shutdown (AC5 from E3-01)
  process.on("SIGTERM", async () => {
    await mcpServer.close();
    process.exit(0);
  });
}

function buildMcpResult(result: unknown): {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
} {
  if (
    result !== null &&
    typeof result === "object" &&
    "isError" in result &&
    (result as { isError: boolean }).isError
  ) {
    return result as { isError: true; content: [{ type: "text"; text: string }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

function extractZodShape(schema: ToolSpec["inputSchema"]): ZodRawShape {
  // McpServer.tool() accepts ZodRawShape or AnySchema
  // If the schema is z.object(), extract its shape for the SDK
  if (schema instanceof z.ZodObject) {
    return schema.shape as ZodRawShape;
  }
  // For other Zod types, wrap in object
  return { _input: schema } as ZodRawShape;
}

async function executeInBackground(
  tool: ToolSpec,
  input: unknown,
  ctx: ToolContext,
  _authSession: AuthSession | null,
  taskId: string,
  idempotency: IdempotencyCache,
): Promise<void> {
  try {
    const result = await tool.execute(input, ctx);
    taskStore.complete(taskId, result);
    const idempKey = IdempotencyCache.computeKey(tool.name, input as Record<string, unknown>);
    idempotency.set(
      tool.name,
      idempKey,
      buildMcpResult(result),
      tool.idempotencyWindowSeconds ?? 86400,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    taskStore.fail(taskId, msg);
  }
}
