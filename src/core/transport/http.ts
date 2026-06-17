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

import { createHash, randomUUID } from "node:crypto";
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

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const b64 = jwt.split(".")[1];
    if (!b64) return null;
    return JSON.parse(Buffer.from(b64, "base64").toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isJwtExpired(jwt: string): boolean {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return true;
  const exp = payload.exp;
  if (typeof exp === "number") return Date.now() / 1000 > exp;
  return false;
}

/**
 * Identity that owns an HTTP session. Derived ONLY from the verified Bearer JWT —
 * never from a client-supplied field. Falls back to a hash of the whole token
 * when the JWT carries no `sub`.
 */
export function jwtIdentity(jwt: string): string {
  const sub = decodeJwtPayload(jwt)?.sub;
  if (typeof sub === "string" && sub.length > 0) return sub;
  // TODO(E13): require a `sub` claim once all upstream tokens carry one.
  return createHash("sha256").update(jwt).digest("hex");
}

function send401(res: ServerResponse, correlationId: string, message: string): void {
  const body = JSON.stringify({ error: "Unauthorized", message });
  // Align with the MCP Authorization spec: advertise the protected-resource
  // metadata document when MCP_API_BASE_URL is known, else a generic challenge.
  const base = process.env.MCP_API_BASE_URL?.replace(/\/$/, "");
  const wwwAuthenticate = base
    ? `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`
    : 'Bearer error="invalid_token"';
  res.writeHead(401, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Correlation-Id": correlationId,
    "WWW-Authenticate": wwwAuthenticate,
  });
  res.end(body);
}

function send403(res: ServerResponse, correlationId: string, error: string): void {
  const body = JSON.stringify({ error });
  res.writeHead(403, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Correlation-Id": correlationId,
  });
  res.end(body);
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** DNS-rebinding defense: reject browser Origins not on the allow-list. Non-browser clients send no Origin and are allowed. */
export function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin as string | undefined;
  if (!origin) return true; // CLIs / SDKs do not send Origin
  const allowed = csvEnv("MCP_ALLOWED_ORIGINS");
  return allowed.includes("*") || allowed.includes(origin);
}

/** Option B (off by default): only enforced when MCP_ALLOWED_HOSTS is set or MCP_HTTP_PUBLIC=true. */
function isHostValidationActive(): boolean {
  return csvEnv("MCP_ALLOWED_HOSTS").length > 0 || process.env.MCP_HTTP_PUBLIC === "true";
}

export function isHostAllowed(req: IncomingMessage): boolean {
  if (!isHostValidationActive()) return true; // preserves pre-E13 behaviour
  const host = (req.headers.host ?? "").toLowerCase();
  const allowed = csvEnv("MCP_ALLOWED_HOSTS").map((h) => h.toLowerCase());
  return allowed.includes("*") || allowed.includes(host);
}

export class HttpTransport {
  private readonly sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; ownerSub: string }
  >();
  private sessionFactory: ((transport: StreamableHTTPServerTransport) => Promise<void>) | null =
    null;
  private getSseStatus: (() => "connected" | "disconnected" | "unused") | null = null;

  constructor(
    public readonly port = Number(process.env.PORT ?? process.env.HTTP_PORT ?? 8080),
    public readonly host: string = process.env.MCP_HTTP_HOST ?? "127.0.0.1",
  ) {}

  /** Wire SSE bridge status into /healthz (called from server.ts after bridge creation). */
  setSseStatusProvider(provider: () => "connected" | "disconnected" | "unused"): void {
    this.getSseStatus = provider;
  }

  /** Register factory that creates and connects a fresh McpServer per session. */
  setSessionFactory(factory: (transport: StreamableHTTPServerTransport) => Promise<void>): void {
    this.sessionFactory = factory;
  }

  private createAndRegisterSession(ownerSub: string): StreamableHTTPServerTransport {
    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    this.sessions.set(sessionId, { transport, ownerSub });
    transport.onclose = () => {
      this.sessions.delete(sessionId);
      log.info({ sessionId }, "MCP session closed");
    };
    log.info({ sessionId }, "MCP session created");
    return transport;
  }

  async start(): Promise<void> {
    // Fail-closed: refuse to start in public mode without an explicit allow-list.
    if (
      process.env.MCP_HTTP_PUBLIC === "true" &&
      csvEnv("MCP_ALLOWED_ORIGINS").length === 0 &&
      csvEnv("MCP_ALLOWED_HOSTS").length === 0
    ) {
      throw new Error(
        "MCP_HTTP_PUBLIC=true requires MCP_ALLOWED_ORIGINS or MCP_ALLOWED_HOSTS to be set — refusing to start fail-open",
      );
    }

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

        // DNS-rebinding defense (MCP Streamable HTTP MUST): validate Origin (and
        // optionally Host) before doing anything else with the request.
        if (!isOriginAllowed(req)) {
          log.warn(
            { correlationId, transport: "http" },
            `Origin not allowed: ${req.headers.origin}`,
          );
          send403(res, correlationId, "Origin not allowed");
          return;
        }
        if (!isHostAllowed(req)) {
          log.warn({ correlationId, transport: "http" }, `Host not allowed: ${req.headers.host}`);
          send403(res, correlationId, "Host not allowed");
          return;
        }

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
                if (jwtIdentity(jwt) !== existing.ownerSub) {
                  log.warn(
                    { sessionId: sessionIdHeader, correlationId, transport: "http" },
                    "Session identity mismatch",
                  );
                  send403(res, correlationId, "Session does not belong to this identity");
                  return;
                }
                sessionTransport = existing.transport;
              } else {
                // New session — create transport, wire McpServer before handling initialize
                sessionTransport = this.createAndRegisterSession(jwtIdentity(jwt));
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
          if (jwtIdentity(jwt) !== existing.ownerSub) {
            log.warn(
              { sessionId: sessionIdHeader, correlationId, transport: "http" },
              "Session identity mismatch",
            );
            send403(res, correlationId, "Session does not belong to this identity");
            return;
          }
          void httpRequestContext.run({ jwt, correlationId }, () =>
            existing.transport.handleRequest(req, res, null),
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
      server.listen(this.port, this.host, () => {
        log.info({ transport: "http" }, `HTTP transport listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }
}
