/**
 * Device flow token store for Azure AD interactive auth (E3-03 extension).
 *
 * Used when MCP_OPENID_ISSUER + MCP_OPENID_CLIENT_ID are set but
 * MCP_OPENID_REFRESH_TOKEN is absent — this triggers the OAuth 2.0
 * Device Authorization Grant (RFC 8628).
 *
 * session_login tool drives the flow via MCP elicitation; this store
 * bridges the result back to the AuthSession middleware.
 */
import type { AuthAdapter, AuthContext } from "./session.js";

let storedToken: AuthContext | null = null;

/** Process-level singleton — valid for the lifetime of the server process */
export const deviceFlowStore = {
  get(): AuthContext | null {
    if (!storedToken) return null;
    // Treat as expired if within 60 s of expiry
    if (storedToken.expiresAt - Date.now() < 60_000) {
      storedToken = null;
      return null;
    }
    return storedToken;
  },
  set(token: string, expiresAt: number): void {
    storedToken = { token, expiresAt };
  },
  clear(): void {
    storedToken = null;
  },
};

/**
 * Auth adapter for Azure AD device flow.
 * Returns the stored JWT from deviceFlowStore when available.
 * Throws with a user-facing message when session_login has not been called yet.
 */
export class DeviceFlowAdapter implements AuthAdapter {
  async login(): Promise<AuthContext> {
    const stored = deviceFlowStore.get();
    if (stored) return stored;
    throw new Error(
      "Azure AD authentication required. " +
        "Please call the 'session_login' tool to sign in interactively.",
    );
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    deviceFlowStore.clear();
    return this.login();
  }
}
