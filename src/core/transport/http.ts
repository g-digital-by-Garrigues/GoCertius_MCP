/**
 * Streamable HTTP transport — stateless-ready (E8, ADR-A8 amended 2026-07-01).
 * Per-request: a fresh McpServer + StreamableHTTPServerTransport are constructed for
 * every POST, matching the MCP SDK's own `simpleStatelessStreamableHttp` reference
 * pattern (`sessionIdGenerator: undefined`). No server-side Mcp-Session-Id map / session
 * affinity — safe to run behind a load balancer without sticky routing.
 *
 * Routes:
 *   POST   /mcp   — client→server JSON-RPC (Streamable HTTP, stateless)
 *   GET    /mcp   — 405 (no session to stream server-initiated notifications to)
 *   DELETE /mcp   — 405 (no session to delete)
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
 * Stable identity hash derived ONLY from a verified Bearer JWT — never from a
 * client-supplied field. Falls back to a hash of the whole token when the JWT
 * carries no `sub`. General-purpose utility (e.g. correlation/logging); no longer
 * used for session-affinity binding now the transport is stateless (ADR-A8 amended).
 */
export function jwtIdentity(jwt: string): string {
  const sub = decodeJwtPayload(jwt)?.sub;
  if (typeof sub === "string" && sub.length > 0) return sub;
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

/**
 * Default POST /mcp body cap (Story 3.2, audit S2): 16 MiB. Sized so the
 * documented tool contracts keep working out of the box (code review
 * 2026-07-07, D1): evidence_upload's "~10 MB max" contentBase64 becomes
 * ~13.4 MiB of base64 plus JSON envelope — a 5 MiB cap broke it in HTTP mode.
 * The DoS vector stays closed; the ceiling is just contract-compatible.
 * Interacts with MCP_FILE_MAX_BYTES (files layer, default 1 GiB): base64
 * sources are ALWAYS additionally capped by this transport limit.
 */
const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Body cap from MCP_HTTP_MAX_BODY_BYTES; invalid or non-positive values fall back to the default. Read per request (test-friendly, same style as the allow-list env reads). */
function maxBodyBytes(): number {
  const parsed = Number(process.env.MCP_HTTP_MAX_BODY_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_BYTES;
}

/**
 * 413 with a JSON-RPC error body (Story 3.2): the request itself is
 * unacceptable → -32600 Invalid Request. `onFlushed` (code review 2026-07-07,
 * P1) runs once the response bytes are handed to the socket — the caller
 * destroys the request THERE, not before, so the queued 413 isn't lost to a
 * TCP RST when tearing down a socket with unread inbound data.
 */
function send413(
  res: ServerResponse,
  correlationId: string,
  limit: number,
  onFlushed?: () => void,
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32600,
      message: `Request body exceeds MCP_HTTP_MAX_BODY_BYTES (${limit} bytes)`,
    },
    id: null,
  });
  res.writeHead(413, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Correlation-Id": correlationId,
  });
  res.end(body, onFlushed);
}

/** Stateless mode: GET/DELETE have no session to stream to or delete (matches the SDK's own reference example). */
function send405MethodNotAllowed(res: ServerResponse, correlationId: string): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
  res.writeHead(405, {
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

/** A handle the transport can close once the HTTP response for a request finishes. */
export interface RequestHandlerHandle {
  close(): Promise<void>;
}

/** Constructs + connects a fresh McpServer to the given per-request transport. */
export type RequestHandlerFactory = (
  transport: StreamableHTTPServerTransport,
) => Promise<RequestHandlerHandle>;

export class HttpTransport {
  private requestHandlerFactory: RequestHandlerFactory | null = null;
  private getSseStatus: (() => "connected" | "disconnected" | "unused") | null = null;
  private bearerVerifier: ((jwt: string) => Promise<boolean>) | null = null;
  private server: ReturnType<typeof createServer> | null = null;

  constructor(
    public readonly port = Number(process.env.PORT ?? process.env.HTTP_PORT ?? 8080),
    public readonly host: string = process.env.MCP_HTTP_HOST ?? "127.0.0.1",
  ) {}

  /** Actual bound port (differs from `port` when constructed with `0` — OS-assigned; used by tests). */
  get boundPort(): number {
    const addr = this.server?.address();
    return addr && typeof addr === "object" ? addr.port : this.port;
  }

  /** Wire SSE bridge status into /healthz (called from server.ts after bridge creation). */
  setSseStatusProvider(provider: () => "connected" | "disconnected" | "unused"): void {
    this.getSseStatus = provider;
  }

  /** Register the factory that constructs + connects a fresh McpServer for every POST request. */
  setRequestHandlerFactory(factory: RequestHandlerFactory): void {
    this.requestHandlerFactory = factory;
  }

  /**
   * Opt-in inbound-Bearer verifier (RFC 7662 introspection, Story 2.3).
   * CONTRACT: must be called BEFORE start() — the public-mode fail-closed gate
   * (Story 3.1) reads the effective verifier at start() time; wiring it later
   * would make a correctly-configured public deployment refuse to boot.
   * server.ts honors this order (verifier at ~:160, start at ~:211).
   */
  setBearerVerifier(verifier: (jwt: string) => Promise<boolean>): void {
    this.bearerVerifier = verifier;
  }

  /**
   * Verify the inbound Bearer when introspection is configured.
   * Passthrough (true) when no verifier is set; fail-closed (false) on verifier error.
   */
  private async verifyIntrospection(jwt: string, correlationId: string): Promise<boolean> {
    if (!this.bearerVerifier) return true;
    try {
      return await this.bearerVerifier(jwt);
    } catch (err) {
      log.error({ err, correlationId, transport: "http" }, "Bearer introspection failed");
      return false;
    }
  }

  async start(): Promise<void> {
    // Foot-gun guard (code review 2026-07-07, P2): the public-mode flag only
    // recognizes the exact string "true" — TRUE/1/yes silently leave EVERY
    // public protection inactive. Warn (don't throw: "false"/"0"/"" are
    // legitimate offs) so a typo'd deployment manifest is visible at boot.
    const publicFlag = process.env.MCP_HTTP_PUBLIC;
    if (publicFlag && publicFlag !== "true" && publicFlag !== "false" && publicFlag !== "0") {
      log.warn(
        { transport: "http" },
        `MCP_HTTP_PUBLIC="${publicFlag}" is not the exact string "true" — public-mode protections are INACTIVE`,
      );
    }

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

    // Fail-closed (Story 3.1, audit S1): public mode must never silently forward
    // unverified Bearer tokens upstream. Checks the EFFECTIVE verifier — not the
    // env var — so server.ts's fail-soft wiring (MCP_SVC_INTROSPECT_URL set but
    // client credentials missing → boots without a verifier) is caught here too.
    // Non-public mode is untouched: introspection stays opt-in (NFR3, local DX).
    if (process.env.MCP_HTTP_PUBLIC === "true" && !this.bearerVerifier) {
      if (process.env.MCP_ALLOW_UNVERIFIED_BEARER === "true") {
        log.warn(
          { transport: "http" },
          "MCP_ALLOW_UNVERIFIED_BEARER=true — inbound Bearer tokens will be forwarded upstream " +
            "WITHOUT verification. Only acceptable when an upstream gateway already verifies them.",
        );
      } else {
        throw new Error(
          "MCP_HTTP_PUBLIC=true requires inbound-token introspection: set MCP_SVC_INTROSPECT_URL " +
            "plus MCP_SVC_CLIENT_ID/MCP_SVC_CLIENT_SECRET (RFC 7662). If an upstream gateway " +
            "already verifies tokens, set MCP_ALLOW_UNVERIFIED_BEARER=true explicitly — refusing " +
            "to start fail-open",
        );
      }
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

        // Stateless mode: GET/DELETE have no session to stream to or delete — reject
        // immediately, matching the SDK's own stateless reference example.
        if (req.method !== "POST") {
          send405MethodNotAllowed(res, correlationId);
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

        // Body cap (Story 3.2, audit S2). Content-Length is rejected before any
        // body is read; chunked bodies are cut off the moment the accumulated
        // size crosses the limit. req.destroy() runs from the 413's flush
        // callback (review P1) so the response reaches the client before the
        // socket goes down; `rejected` guards the already-queued data/end
        // events after destruction.
        const bodyLimit = maxBodyBytes();
        // Strict digit parse (review P3): Number() accepts "1e3"/"0x10"/padded
        // forms, and a proxy-merged duplicate header ("100, 100") yields NaN —
        // which would silently skip this pre-check. Node's llhttp rejects those
        // shapes today, but this code must not depend on the parser upstream.
        const clHeader = req.headers["content-length"];
        const declaredLength =
          typeof clHeader === "string" && /^\d+$/.test(clHeader.trim())
            ? Number(clHeader.trim())
            : undefined;
        if (clHeader !== undefined && declaredLength === undefined) {
          log.warn(
            { correlationId, transport: "http" },
            "Non-numeric Content-Length — pre-check skipped, streaming guard still applies",
          );
        }
        if (declaredLength !== undefined && declaredLength > bodyLimit) {
          log.warn(
            { correlationId, transport: "http", declaredLength, bodyLimit },
            "Request body over limit (Content-Length) — rejected before read",
          );
          // Uniform teardown with the streaming path: destroy once flushed.
          send413(res, correlationId, bodyLimit, () => req.destroy());
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        let rejected = false;
        req.on("data", (chunk: Buffer) => {
          if (rejected) return;
          receivedBytes += chunk.length;
          if (receivedBytes > bodyLimit) {
            rejected = true;
            chunks.length = 0; // release what was buffered
            log.warn(
              { correlationId, transport: "http", receivedBytes, bodyLimit },
              "Request body over limit (streaming) — rejected mid-read",
            );
            send413(res, correlationId, bodyLimit, () => req.destroy());
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (rejected) return;
          void (async () => {
            let parsedBody: unknown = null;
            try {
              const raw = Buffer.concat(chunks).toString();
              if (raw) parsedBody = JSON.parse(raw);
            } catch {
              // SDK handles malformed JSON
            }

            // Inbound Bearer introspection (Story 2.3) — body is buffered; safe to await.
            if (!(await this.verifyIntrospection(jwt, correlationId))) {
              send401(res, correlationId, "Bearer token rejected by introspection");
              return;
            }

            try {
              // Fresh transport + server per request (stateless mode, no Mcp-Session-Id).
              // Omitting sessionIdGenerator (rather than passing it as `undefined`) is
              // equivalent at runtime and satisfies exactOptionalPropertyTypes.
              const reqTransport = new StreamableHTTPServerTransport({});
              const handle = this.requestHandlerFactory
                ? await this.requestHandlerFactory(reqTransport)
                : null;

              await httpRequestContext.run({ jwt, correlationId }, () =>
                reqTransport.handleRequest(req, res, parsedBody),
              );

              res.on("close", () => {
                void reqTransport.close();
                void handle?.close();
              });
            } catch (err) {
              log.error({ err, correlationId, transport: "http" }, "Error handling MCP request");
              if (!res.headersSent) {
                const body = JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32603, message: "Internal server error" },
                  id: null,
                });
                res.writeHead(500, {
                  "Content-Type": "application/json",
                  "X-Correlation-Id": correlationId,
                });
                res.end(body);
              }
            }
          })();
        });
        req.on("error", (err) => {
          log.error({ err, correlationId, transport: "http" }, "Request stream error");
        });
        return;
      }

      // 404 for unrecognized paths
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });

    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(this.port, this.host, () => {
        log.info({ transport: "http" }, `HTTP transport listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /** Stop listening (graceful shutdown / test cleanup). */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }
}
