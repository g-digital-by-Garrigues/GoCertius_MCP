/**
 * AuthSession: lazy credential provider with proactive refresh and 401-retry.
 * AC1-AC8 per STR-E3-03.
 */

export interface AuthContext {
  token: string;
  expiresAt: number;
}

/** Auth adapter: obtains + refreshes a session JWT */
export interface AuthAdapter {
  /** Obtain a new session JWT */
  login(): Promise<AuthContext>;
  /** Refresh an existing session (may fall back to re-login) */
  refresh(current: AuthContext): Promise<AuthContext>;
}

const REFRESH_AHEAD_MS = 60_000;
const MAX_REFRESH_RETRIES = 3;

export class AuthSession {
  private cached: AuthContext | null = null;
  /** In-flight exchange shared by every concurrent caller (single-flight). */
  private inFlight: Promise<AuthContext> | null = null;

  constructor(private readonly adapter: AuthAdapter) {}

  /** Returns a valid token, refreshing proactively if close to expiry (AC3) */
  async getToken(): Promise<string> {
    if (!this.cached || this.isExpiringSoon()) {
      return (await this.exchange(() => this.loginWithRetry())).token;
    }
    return this.cached.token;
  }

  /**
   * Retry after a 401 (AC4): refresh once, then return new token.
   * If refresh fails, throw — caller will surface error.
   */
  async refreshAfter401(): Promise<string> {
    const stale = this.cached;
    const ctx = await this.exchange(() =>
      stale ? this.adapter.refresh(stale) : this.loginWithRetry(),
    );
    return ctx.token;
  }

  /**
   * Runs `exchange` unless one is already in flight, in which case every caller
   * awaits the same result.
   *
   * Without this (retro review 2026-09-02) N concurrent tool calls each ran a
   * full credential exchange — on the user-key flow that is N `POST
   * /user-keys/session` with the same long-lived key per burst, which is the
   * shape that trips an auth-endpoint rate limit or a session cap. Stateless
   * HTTP makes bursts the normal case: a fresh McpServer per request shares one
   * process-wide AuthSession. It also removes a destructive interleaving, where
   * two concurrent refreshes could clear a valid token and then both fail.
   *
   * A caller that joins an exchange started just before its own 401 may receive
   * a token minted moments earlier; that token is fresh, and the worst case is
   * one further 401 retry rather than a stampede.
   */
  private async exchange(run: () => Promise<AuthContext>): Promise<AuthContext> {
    const existing = this.inFlight;
    if (existing) {
      const joined = await existing;
      this.cached = joined;
      return joined;
    }
    const pending = run();
    this.inFlight = pending;
    try {
      const fresh = await pending;
      this.cached = fresh;
      return fresh;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  private isExpiringSoon(): boolean {
    if (!this.cached) return true;
    return this.cached.expiresAt - Date.now() < REFRESH_AHEAD_MS;
  }

  private async loginWithRetry(): Promise<AuthContext> {
    let lastErr: unknown;
    for (let i = 0; i < MAX_REFRESH_RETRIES; i++) {
      try {
        return await this.adapter.login();
      } catch (err) {
        lastErr = err;
        if (i < MAX_REFRESH_RETRIES - 1) {
          await sleep(2 ** i * 500);
        }
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`Auth failed after ${MAX_REFRESH_RETRIES} attempts: ${msg}`);
  }

  /** Clear cached token (for testing) */
  invalidate(): void {
    this.cached = null;
  }
}

export function createAuthSession(adapter: AuthAdapter): AuthSession {
  return new AuthSession(adapter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
