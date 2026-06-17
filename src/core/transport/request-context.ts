import { AsyncLocalStorage } from "node:async_hooks";

export interface HttpRequestContext {
  /** Bearer JWT extracted from Authorization header */
  jwt: string;
  /** Per-request correlation ID (UUID v4 or forwarded X-Correlation-Id) */
  correlationId: string;
}

/**
 * AsyncLocalStorage that carries HTTP request context through async call chains.
 * Set by HttpTransport for every /mcp request; read by server.ts tool handlers
 * and buildToolContext to supply per-request JWT and correlationId.
 */
export const httpRequestContext = new AsyncLocalStorage<HttpRequestContext>();
