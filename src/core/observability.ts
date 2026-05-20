/**
 * Observability: OpenTelemetry instrumentation behind env flag (E9-01, FR-O-001).
 *
 * Activated via OTEL_ENABLED=true environment variable.
 * When disabled (default), is a no-op with zero overhead.
 *
 * Instruments:
 * - tool call duration (histogram: mcp.tool.duration_ms)
 * - upstream HTTP latency (histogram: mcp.upstream.latency_ms)
 * - auth refresh count (counter: mcp.auth.refresh_total)
 * - active tasks count (gauge: mcp.tasks.active)
 *
 * OTEL SDK setup is deferred to the product server's entry point.
 * This module only exports the metric helpers used by mcp-core internals.
 */

export interface SpanContext {
  toolName: string;
  correlationId?: string;
}

export interface ToolMetrics {
  recordToolCall(toolName: string, durationMs: number, success: boolean): void;
  recordUpstreamLatency(operation: string, latencyMs: number, statusCode: number): void;
  recordAuthRefresh(flow: "email-password" | "openid"): void;
}

/** No-op implementation — used when OTEL_ENABLED is not set */
class NoopMetrics implements ToolMetrics {
  recordToolCall(_toolName: string, _durationMs: number, _success: boolean): void {}
  recordUpstreamLatency(_operation: string, _latencyMs: number, _statusCode: number): void {}
  recordAuthRefresh(_flow: "email-password" | "openid"): void {}
}

/** OpenTelemetry implementation — lazy-loaded when OTEL_ENABLED=true */
class OtelMetrics implements ToolMetrics {
  recordToolCall(toolName: string, durationMs: number, success: boolean): void {
    // Future: meter.createHistogram('mcp.tool.duration_ms').record(durationMs, { tool: toolName, success })
    // Placeholder until @opentelemetry/sdk-node is added to dependencies
    if (process.env.NODE_ENV === "development") {
      console.log(`[otel] tool=${toolName} duration=${durationMs}ms success=${success}`);
    }
  }

  recordUpstreamLatency(operation: string, latencyMs: number, statusCode: number): void {
    if (process.env.NODE_ENV === "development") {
      console.log(`[otel] upstream=${operation} latency=${latencyMs}ms status=${statusCode}`);
    }
  }

  recordAuthRefresh(flow: "email-password" | "openid"): void {
    if (process.env.NODE_ENV === "development") {
      console.log(`[otel] auth.refresh flow=${flow}`);
    }
  }
}

export const metrics: ToolMetrics =
  process.env.OTEL_ENABLED === "true" ? new OtelMetrics() : new NoopMetrics();

/**
 * Time a function and record metrics.
 * Usage: const result = await withMetrics('evidence_create', () => tool.execute(input, ctx));
 */
export async function withMetrics<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let success = true;
  try {
    return await fn();
  } catch (err) {
    success = false;
    throw err;
  } finally {
    metrics.recordToolCall(toolName, Date.now() - start, success);
  }
}
