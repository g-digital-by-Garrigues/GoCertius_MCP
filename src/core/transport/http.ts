/**
 * Streamable HTTP transport — production-ready (E8).
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
  public readonly sdkTransport: StreamableHTTPServerTransport;
  private getSseStatus: (() => "connected" | "disconnected" | "unused") | null = null;

  constructor(public readonly port = Number(process.env.PORT ?? process.env.HTTP_PORT ?? 8080)) {
    this.sdkTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
  }

  /** Wire SSE bridge status into /healthz (called from server.ts after bridge creation). */
  setSseStatusProvider(provider: () => "connected" | "disconnected" | "unused"): void {
    this.getSseStatus = provider;
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
            process.env.OPENAPI_SNAPSHOT_VERSION ??
            process.env.npm_package_version ??
            "0.0.1",
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
          sse_connection: this.getSseStatus?.() ?? "unused",
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

        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            let parsedBody: unknown = null;
            try {
              const raw = Buffer.concat(chunks).toString();
              if (raw) parsedBody = JSON.parse(raw);
            } catch {
              // SDK handles malformed JSON
            }
            void httpRequestContext.run({ jwt, correlationId }, () =>
              this.sdkTransport.handleRequest(req, res, parsedBody),
            );
          });
          req.on("error", (err) => {
            log.error({ err, correlationId, transport: "http" }, "Request stream error");
          });
        } else {
          // GET / DELETE — no body
          void httpRequestContext.run({ jwt, correlationId }, () =>
            this.sdkTransport.handleRequest(req, res, null),
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
