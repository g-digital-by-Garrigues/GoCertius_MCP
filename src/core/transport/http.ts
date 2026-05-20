/**
 * Streamable HTTP transport adapter — stub (E3-02, FR-E-003, ADR-05).
 *
 * Exposes:
 *   POST /mcp   — client→server JSON-RPC
 *   GET  /mcp   — server→client Streamable HTTP
 *   DELETE /mcp — session teardown
 *   GET  /healthz — health check (AC3)
 *
 * Full Hono integration (middleware, JWT enforcement, etc.) deferred to E8.
 * This stub proves boot + initialize handshake works (AC4).
 * Per-request JWT NOT enforced (AC5 — E8).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const startedAt = Date.now();

export class HonoTransport {
  public readonly sdkTransport: StreamableHTTPServerTransport;

  constructor(public readonly port = Number(process.env.PORT ?? 8080)) {
    // Stateless mode (no sessionIdGenerator) — sessions added in E8
    this.sdkTransport = new StreamableHTTPServerTransport({});
  }

  async start(): Promise<void> {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";

      // AC3: Health check
      if (req.method === "GET" && url === "/healthz") {
        const body = JSON.stringify({
          status: "ok",
          transport: "http",
          uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      // AC1: MCP Streamable HTTP — delegate to SDK transport
      if (url === "/mcp" || url.startsWith("/mcp?")) {
        if (req.method === "POST") {
          // Collect body for POST requests
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            let parsedBody: unknown = null;
            try {
              const raw = Buffer.concat(chunks).toString();
              if (raw) parsedBody = JSON.parse(raw);
            } catch {
              // ignore parse errors — SDK handles malformed JSON
            }
            void this.sdkTransport.handleRequest(req, res, parsedBody);
          });
        } else {
          // GET and DELETE don't have a body
          void this.sdkTransport.handleRequest(req, res, null);
        }
        return;
      }

      // 404 for all other paths
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(this.port, resolve);
    });
  }
}
