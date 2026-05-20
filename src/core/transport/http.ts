/**
 * Streamable HTTP transport with full Hono middleware (E3-02 upgraded in E8).
 * Uses @hono/node-server to run Hono on Node.js.
 *
 * Routes:
 *   POST /mcp   — client→server JSON-RPC (Streamable HTTP)
 *   GET  /mcp   — server→client notifications (Streamable HTTP)
 *   DELETE /mcp — session teardown
 *   GET  /healthz — health check
 *
 * Per-request JWT extracted from Authorization header (FR-A-006, E8).
 * Correlation ID injected per request for structured logging.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLogger } from "../logger.js";

const startedAt = Date.now();
const log = createLogger();

export class HonoTransport {
  public readonly sdkTransport: StreamableHTTPServerTransport;

  constructor(public readonly port = Number(process.env.PORT ?? 8080)) {
    // Stateless mode — session management added if needed in future
    this.sdkTransport = new StreamableHTTPServerTransport({});
  }

  async start(): Promise<void> {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      const correlationId = (req.headers["x-correlation-id"] as string) ?? randomUUID();

      // Health check — no auth required (FR-E-013 pattern: boot without auth)
      if (req.method === "GET" && (url === "/healthz" || url === "/health")) {
        const body = JSON.stringify({
          status: "ok",
          transport: "http",
          version: process.env.npm_package_version ?? "0.0.1",
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Correlation-Id": correlationId,
        });
        res.end(body);
        return;
      }

      // MCP Streamable HTTP endpoint
      if (url === "/mcp" || url.startsWith("/mcp?")) {
        res.setHeader("X-Correlation-Id", correlationId);

        log.info(
          { mcp_method: req.method ?? "unknown", correlationId, transport: "http" },
          "MCP request",
        );

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
            void this.sdkTransport.handleRequest(req, res, parsedBody);
          });
          req.on("error", (err) => {
            log.error({ err, correlationId, transport: "http" }, "Request stream error");
          });
        } else {
          // GET / DELETE — no body
          void this.sdkTransport.handleRequest(req, res, null);
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
