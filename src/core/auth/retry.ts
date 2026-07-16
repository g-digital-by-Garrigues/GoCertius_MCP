/**
 * 401 refresh-retry-once for server-managed auth (Story 2.2, ADR-A2 / FR-5..8).
 *
 * `AuthSession` already caches tokens and refreshes proactively 60s before expiry.
 * This wraps a tool execution so that an upstream HTTP 401 triggers exactly one
 * session refresh (`refreshAfter401`) and one retry with the fresh token. A second
 * failure — 401 or otherwise — propagates to the caller's normal error mapping.
 *
 * Retry is gated by `canRefresh`: only when the call uses the server-managed
 * AuthSession (not a per-request Bearer JWT) and the tool is refreshable.
 */
import { isUnauthorizedError } from "../errors/index.js";
import type { AuthSession } from "./session.js";

export interface ToolAuth {
  token: string;
  expiresAt: number;
}

export interface AuthRetryOptions {
  authSession: AuthSession | null;
  /** Whether a 401 may trigger a server-session refresh + retry. */
  canRefresh: boolean;
}

/** Default lifetime stamped on the retry auth context (real expiry is tracked inside AuthSession). */
const RETRY_AUTH_TTL_MS = 3600_000;

/**
 * Run `run(auth)`; on an upstream 401 (and only when `canRefresh`), refresh the
 * session once and retry `run` exactly once with the new token.
 */
export async function executeWithAuthRetry<T>(
  run: (auth: ToolAuth | null) => Promise<T>,
  initialAuth: ToolAuth | null,
  opts: AuthRetryOptions,
): Promise<T> {
  try {
    return await run(initialAuth);
  } catch (err) {
    if (opts.canRefresh && opts.authSession && isUnauthorizedError(err)) {
      const token = await opts.authSession.refreshAfter401();
      // Single retry: if this throws, it propagates (no further retries).
      return await run({ token, expiresAt: Date.now() + RETRY_AUTH_TTL_MS });
    }
    throw err;
  }
}
