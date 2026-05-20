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

  constructor(private readonly adapter: AuthAdapter) {}

  /** Returns a valid token, refreshing proactively if close to expiry (AC3) */
  async getToken(): Promise<string> {
    if (!this.cached || this.isExpiringSoon()) {
      this.cached = await this.loginWithRetry();
    }
    return this.cached.token;
  }

  /**
   * Retry after a 401 (AC4): refresh once, then return new token.
   * If refresh fails, throw — caller will surface error.
   */
  async refreshAfter401(): Promise<string> {
    if (!this.cached) {
      this.cached = await this.loginWithRetry();
      return this.cached.token;
    }
    this.cached = await this.adapter.refresh(this.cached);
    return this.cached.token;
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
