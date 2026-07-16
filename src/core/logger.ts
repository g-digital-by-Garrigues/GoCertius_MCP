/**
 * Structured logger with allow-list field filtering and credential redaction (E3-08).
 * All output goes to stderr. Follows pino v10 API.
 *
 * Allowed log fields (AC2): tool, product, transport, upstream_status, upstream_latency_ms,
 * mcp_method, correlationId, sessionId, method, path, status, latencyMs,
 * declaredLength, receivedBytes, bodyLimit, level, time, msg, err, pid,
 * hostname. Fields outside this list are silently dropped.
 *
 * method/path/status/latencyMs (Story 3.3, audit G2): the HTTP access-log line in
 * transport/http.ts always emitted them, but they were typed in LogContext without
 * ever being allow-listed — every access log shipped without its four core fields.
 *
 * Credential patterns (AC3): any value matching *password*, *token*, *secret*, *refresh*
 * replaced with ***<last-4>.
 */
import pino from "pino";

const ALLOWED_FIELDS = new Set([
  "tool",
  "product",
  "transport",
  "upstream_status",
  "upstream_latency_ms",
  "mcp_method",
  "correlationId",
  "sessionId",
  "method",
  "path",
  "status",
  "latencyMs",
  "declaredLength",
  "receivedBytes",
  "bodyLimit",
  "level",
  "time",
  "msg",
  "err",
  "pid",
  "hostname",
]);

const CREDENTIAL_PATTERN = /password|token|secret|refresh|auth_password|auth_email/i;

function redactValue(key: string, value: unknown): unknown {
  if (CREDENTIAL_PATTERN.test(key) && typeof value === "string") {
    const last4 = value.slice(-4).padStart(4, "*");
    return `***${last4}`;
  }
  return value;
}

function filterAndRedact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    out[k] = redactValue(k, v);
  }
  return out;
}

export interface LogContext {
  tool?: string;
  product?: string;
  transport?: string;
  upstream_status?: number;
  upstream_latency_ms?: number;
  mcp_method?: string;
  correlationId?: string;
  sessionId?: string;
  err?: Error | unknown;
  // HTTP request logging (STR-E8-03)
  method?: string;
  path?: string;
  status?: number;
  latencyMs?: number;
  // POST /mcp body-limit diagnostics (Story 3.2, audit S2)
  declaredLength?: number;
  receivedBytes?: number;
  bodyLimit?: number;
}

export class Logger {
  private readonly pino: pino.Logger;

  constructor(level = process.env.LOG_LEVEL ?? "info") {
    this.pino = pino({ level }, process.stderr);
  }

  child(bindings: Record<string, unknown>): Logger {
    const child = new Logger();
    (child as unknown as { pino: pino.Logger }).pino = this.pino.child(filterAndRedact(bindings));
    return child;
  }

  info(obj: LogContext, msg: string): void;
  info(msg: string): void;
  info(objOrMsg: LogContext | string, msg?: string): void {
    if (typeof objOrMsg === "string") {
      this.pino.info(objOrMsg);
    } else {
      this.pino.info(filterAndRedact(objOrMsg as Record<string, unknown>), msg);
    }
  }

  warn(obj: LogContext, msg: string): void;
  warn(msg: string): void;
  warn(objOrMsg: LogContext | string, msg?: string): void {
    if (typeof objOrMsg === "string") {
      this.pino.warn(objOrMsg);
    } else {
      this.pino.warn(filterAndRedact(objOrMsg as Record<string, unknown>), msg);
    }
  }

  error(obj: LogContext, msg: string): void;
  error(msg: string): void;
  error(objOrMsg: LogContext | string, msg?: string): void {
    if (typeof objOrMsg === "string") {
      this.pino.error(objOrMsg);
    } else {
      this.pino.error(filterAndRedact(objOrMsg as Record<string, unknown>), msg);
    }
  }

  debug(obj: LogContext, msg: string): void;
  debug(msg: string): void;
  debug(objOrMsg: LogContext | string, msg?: string): void {
    if (typeof objOrMsg === "string") {
      this.pino.debug(objOrMsg);
    } else {
      this.pino.debug(filterAndRedact(objOrMsg as Record<string, unknown>), msg);
    }
  }
}

export const logger = new Logger();

export function createLogger(options?: { level?: string }): Logger {
  return new Logger(options?.level);
}
