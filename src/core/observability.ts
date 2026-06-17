/**
 * Observability: OpenTelemetry instrumentation behind env flag (E9-01, FR-O-003, FR-O-004).
 *
 * Activated via MCP_OTEL_ENABLED=true. Off by default — zero overhead for npx/stdio users.
 *
 * Span attributes per tool call:
 *   tool.name, tool.pollable, mcp.transport, upstream.status_code, upstream.latency_ms
 *
 * Metrics emitted (when enabled):
 *   mcp.tool.duration_ms  — histogram
 *   mcp.upstream.latency_ms — histogram
 *   mcp.auth.refresh_total — counter
 *
 * OTEL endpoint: OTEL_EXPORTER_OTLP_ENDPOINT (default http://localhost:4318)
 *
 * Lazy-load pattern: @opentelemetry/api is dynamically imported only when the flag is set.
 * The OTel SDK itself (@opentelemetry/sdk-node) must be installed by the consumer who opts in.
 * If the import fails (not installed), OtelMetrics silently falls back to structured log lines.
 */

import { createLogger } from "./logger.js";

const otelLog = createLogger();

export interface SpanContext {
  toolName: string;
  correlationId?: string;
}

export interface ToolMetrics {
  recordToolCall(
    toolName: string,
    durationMs: number,
    success: boolean,
    attrs?: { pollable?: boolean; transport?: string },
  ): void;
  recordUpstreamLatency(operation: string, latencyMs: number, statusCode: number): void;
  recordAuthRefresh(flow: "email-password" | "openid"): void;
}

// ── No-op ──────────────────────────────────────────────────────────────────────

class NoopMetrics implements ToolMetrics {
  recordToolCall(): void {}
  recordUpstreamLatency(): void {}
  recordAuthRefresh(): void {}
}

// ── OTel (lazy-loaded) ────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: OTel API shape varies by version — typed at runtime
type OtelApi = any;

let _otelApi: OtelApi | null = null;
let _otelAttempted = false;

async function getOtelApi(): Promise<OtelApi | null> {
  if (_otelAttempted) return _otelApi;
  _otelAttempted = true;
  try {
    // Use Function constructor to bypass TS static import resolution for optional peer dep.
    // @opentelemetry/api must be installed by consumers who set MCP_OTEL_ENABLED=true.
    const lazyImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    _otelApi = await lazyImport("@opentelemetry/api");
    otelLog.info({ transport: "otel" }, "OpenTelemetry API loaded");
  } catch {
    otelLog.warn(
      { transport: "otel" },
      "MCP_OTEL_ENABLED=true but @opentelemetry/api not installed — falling back to structured log lines. Install @opentelemetry/sdk-node to enable full tracing.",
    );
  }
  return _otelApi;
}

class OtelMetrics implements ToolMetrics {
  private readonly meter = "mcp-core";
  private readonly endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

  recordToolCall(
    toolName: string,
    durationMs: number,
    success: boolean,
    attrs: { pollable?: boolean; transport?: string } = {},
  ): void {
    void (async () => {
      const api = await getOtelApi();
      if (api) {
        const meter = api.metrics.getMeter(this.meter);
        meter.createHistogram("mcp.tool.duration_ms", { unit: "ms" }).record(durationMs, {
          "tool.name": toolName,
          "tool.success": String(success),
          "tool.pollable": String(attrs.pollable ?? false),
          "mcp.transport": attrs.transport ?? "stdio",
        });
      } else {
        // Structured log fallback (pino-compatible)
        otelLog.info(
          { tool: toolName, latencyMs: durationMs, transport: attrs.transport ?? "stdio" },
          success ? "tool.call.ok" : "tool.call.error",
        );
      }
    })();
    // Log endpoint on first call for discoverability
    if (!_otelAttempted) {
      otelLog.info({ transport: "otel" }, `OTel endpoint: ${this.endpoint}`);
    }
  }

  recordUpstreamLatency(operation: string, latencyMs: number, statusCode: number): void {
    void (async () => {
      const api = await getOtelApi();
      if (api) {
        const meter = api.metrics.getMeter(this.meter);
        meter.createHistogram("mcp.upstream.latency_ms", { unit: "ms" }).record(latencyMs, {
          "upstream.operation": operation,
          "upstream.status_code": String(statusCode),
        });
      } else {
        otelLog.info(
          { upstream_latency_ms: latencyMs, upstream_status: statusCode },
          `upstream.${operation}`,
        );
      }
    })();
  }

  recordAuthRefresh(flow: "email-password" | "openid"): void {
    void (async () => {
      const api = await getOtelApi();
      if (api) {
        const meter = api.metrics.getMeter(this.meter);
        meter.createCounter("mcp.auth.refresh_total").add(1, { "auth.flow": flow });
      } else {
        otelLog.info({ transport: "otel" }, `auth.refresh flow=${flow}`);
      }
    })();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const metrics: ToolMetrics =
  process.env.MCP_OTEL_ENABLED === "true" ? new OtelMetrics() : new NoopMetrics();

/**
 * Time a function and record metrics. Wraps tool execution in server.ts.
 * When MCP_OTEL_ENABLED=true, emits mcp.tool.duration_ms with span attributes.
 */
export async function withMetrics<T>(
  toolName: string,
  fn: () => Promise<T>,
  attrs: { pollable?: boolean; transport?: string } = {},
): Promise<T> {
  const start = Date.now();
  let success = true;
  try {
    return await fn();
  } catch (err) {
    success = false;
    throw err;
  } finally {
    metrics.recordToolCall(toolName, Date.now() - start, success, attrs);
  }
}
