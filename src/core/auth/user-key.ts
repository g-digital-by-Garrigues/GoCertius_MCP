/**
 * User-key auth adapter (Epic E14).
 * POST /user-keys/session { key } → { jwt } (sessionType "UserKey", ~24 h).
 *
 * A long-lived user key (issued out-of-band, ~12 months) is exchanged for a
 * short-lived session JWT. Refresh = re-exchange the key (no interactive step).
 * The AuthSession wrapper handles caching, proactive refresh, and 401 retry.
 */
import type { AuthAdapter, AuthContext } from "./session.js";

export interface UserKeyConfig {
  baseUrl: string;
  userKey: string;
}

export class UserKeyAdapter implements AuthAdapter {
  constructor(private readonly config: UserKeyConfig) {}

  async login(): Promise<AuthContext> {
    const res = await fetch(`${this.config.baseUrl}/user-keys/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The key goes in the BODY (not a Bearer header).
      body: JSON.stringify({ key: this.config.userKey }),
    });

    if (!res.ok) {
      throw new Error(`MCP_AUTH_USER_KEY rejected by /user-keys/session: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { jwt?: string; token?: string };
    const token = body.jwt ?? body.token;
    if (!token) throw new Error("/user-keys/session response missing jwt field");

    return { token, expiresAt: jwtExpiryMs(token) };
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    // The user key is long-lived; refresh = exchange it again for a fresh session JWT.
    return this.login();
  }
}

/** Read the JWT `exp` (seconds) as epoch ms; fall back to now + 23 h if absent/unparseable. */
function jwtExpiryMs(jwt: string): number {
  const fallback = Date.now() + 23 * 3600_000;
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) return fallback;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}
