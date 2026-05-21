/**
 * Streamable HTTP transport — production-ready (E8).
 * Multi-session: each MCP client gets its own StreamableHTTPServerTransport (Bug 2 fix).
 *
 * Routes:
 *   POST /mcp   — client→server JSON-RPC (Streamable HTTP)
 *   GET  /mcp   — server→client notifications (Streamable HTTP)
 *   DELETE /mcp — session teardown
 *   GET  /healthz — health check (no auth required)
 *
 * Per-request JWT: extracted from Authorization: Bearer <jwt> (STR-E8-01).
 * Correlation ID: generated per request, forwarded in X-Correlation-Id (STR-E8-03).
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLogger } from "../logger.js";
import { httpRequestContext } from "./request-context.js";

const startedAt = Date.now();
const log = createLogger();

function extractBearer(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

function isJwtExpired(jwt: string): boolean {
  try {
    const b64 = jwt.split(".")[1];
    if (!b64) return true;
    const payload = JSON.parse(Buffer.from(b64, "base64").toString()) as Record<string, unknown>;
    const exp = payload.exp;
    if (typeof exp === "number") return Date.now() / 1000 > exp;
    return false;
  } catch {
    return true;
  }
}

function send401(res: ServerResponse, correlationId: string, message: string): void {
  const body = JSON.stringify({ error: "Unauthorized", message });
  res.writeHead(401, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Correlation-Id": correlationId,
  });
  res.end(body);
}

export class HonoTransport {
  private readonly sessions = new Map<string, StreamableHTTPServerTransport>();
  private sessionFactory: ((transport: StreamableHTTPServerTransport) => Promise<void>) | null =
    null;
  private getSseStatus: (() => "connected" | "disconnected" | "unused") | null = null;

  constructor(public readonly port = Number(process.env.PORT ?? process.env.HTTP_PORT ?? 8080)) {}

  /** Wire SSE bridge status into /healthz (called from server.ts after bridge creation). */
  setSseStatusProvider(provider: () => "connected" | "disconnected" | "unused"): void {
    this.getSseStatus = provider;
  }

  /** Register factory that creates and connects a fresh McpServer per session. */
  setSessionFactory(factory: (transport: StreamableHTTPServerTransport) => Promise<void>): void {
    this.sessionFactory = factory;
  }

  private createAndRegisterSession(): StreamableHTTPServerTransport {
    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    this.sessions.set(sessionId, transport);
    transport.onclose = () => {
      this.sessions.delete(sessionId);
      log.info({ sessionId }, "MCP session closed");
    };
    log.info({ sessionId }, "MCP session created");
    return transport;
  }

  async start(): Promise<void> {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      const correlationId = (req.headers["x-correlation-id"] as string) ?? randomUUID();
      const startMs = Date.now();

      res.on("finish", () => {
        log.info(
          {
            ...(req.method !== undefined ? { method: req.method } : {}),
            path: url.split("?")[0] ?? url,
            status: res.statusCode,
            latencyMs: Date.now() - startMs,
            correlationId,
            transport: "http",
          },
          "request",
        );
      });

      // Health check — no auth required
      if (req.method === "GET" && (url === "/healthz" || url === "/health")) {
        const body = JSON.stringify({
          status: "ok",
          transport: "http",
          version: process.env.npm_package_version ?? "0.0.1",
          openapi_snapshot_version:
            process.env.OPENAPI_SNAPSHOT_VERSION ?? process.env.npm_package_version ?? "0.0.1",
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
          sse_connection: this.getSseStatus?.() ?? "unused",
          active_sessions: this.sessions.size,
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Correlation-Id": correlationId,
        });
        res.end(body);
        return;
      }

      // MCP Streamable HTTP endpoint — per-request JWT required
      if (url === "/mcp" || url.startsWith("/mcp?")) {
        res.setHeader("X-Correlation-Id", correlationId);

        const jwt = extractBearer(req);
        if (!jwt) {
          send401(res, correlationId, "Missing Authorization: Bearer <jwt>");
          return;
        }
        if (isJwtExpired(jwt)) {
          send401(res, correlationId, "JWT is expired — refresh upstream and retry");
          return;
        }

        const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;

        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            void (async () => {
              let parsedBody: unknown = null;
              try {
                const raw = Buffer.concat(chunks).toString();
                if (raw) parsedBody = JSON.parse(raw);
              } catch {
                // SDK handles malformed JSON
              }

              let sessionTransport: StreamableHTTPServerTransport;

              if (sessionIdHeader) {
                const existing = this.sessions.get(sessionIdHeader);
                if (!existing) {
                  res.writeHead(404, {
                    "Content-Type": "application/json",
                    "X-Correlation-Id": correlationId,
                  });
                  res.end(JSON.stringify({ error: "Session not found or expired" }));
                  return;
                }
                sessionTransport = existing;
              } else {
                // New session — create transport, wire McpServer before handling initialize
                sessionTransport = this.createAndRegisterSession();
                if (this.sessionFactory) {
                  await this.sessionFactory(sessionTransport);
                }
              }

              void httpRequestContext.run({ jwt, correlationId }, () =>
                sessionTransport.handleRequest(req, res, parsedBody),
              );
            })();
          });
          req.on("error", (err) => {
            log.error({ err, correlationId, transport: "http" }, "Request stream error");
          });
        } else {
          // GET / DELETE — session ID required (client must have completed initialize first)
          if (!sessionIdHeader) {
            res.writeHead(400, {
              "Content-Type": "application/json",
              "X-Correlation-Id": correlationId,
            });
            res.end(JSON.stringify({ error: "Missing Mcp-Session-Id header" }));
            return;
          }
          const existing = this.sessions.get(sessionIdHeader);
          if (!existing) {
            res.writeHead(404, {
              "Content-Type": "application/json",
              "X-Correlation-Id": correlationId,
            });
            res.end(JSON.stringify({ error: "Session not found or expired" }));
            return;
          }
          void httpRequestContext.run({ jwt, correlationId }, () =>
            existing.handleRequest(req, res, null),
          );
        }
        return;
      }

      // 404 for unrecognized paths
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(this.port, () => {
        log.info({ transport: "http" }, `HTTP transport listening on port ${this.port}`);
        resolve();
      });
    });
  }
}
