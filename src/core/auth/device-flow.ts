/**
 * In-process session-token store (E3-03 extension).
 *
 * Holds a JWT for the process lifetime and bridges it to the AuthSession
 * middleware. Two producers seed it:
 *  - `MCP_AUTH_JWT` — a pre-seeded JWT (server.ts seeds it at startup).
 *  - the `session_login` tool — after an email/password login it stores the
 *    resulting session JWT here for subsequent tool calls.
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
 * Auth adapter that serves the JWT held in deviceFlowStore.
 * Used for a pre-seeded `MCP_AUTH_JWT` and for the JWT stored by `session_login`.
 * Throws a user-facing message when no session has been established yet.
 */
export class DeviceFlowAdapter implements AuthAdapter {
  async login(): Promise<AuthContext> {
    const stored = deviceFlowStore.get();
    if (stored) return stored;
    throw new Error(
      "No active session. Please call the 'session_login' tool to authenticate.",
    );
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    deviceFlowStore.clear();
    return this.login();
  }
}
