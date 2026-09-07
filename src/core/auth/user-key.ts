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

/** Upper bound on an auth exchange. Without it a hung endpoint blocks every caller. */
const AUTH_TIMEOUT_MS = 15_000;

export class UserKeyAdapter implements AuthAdapter {
  constructor(private readonly config: UserKeyConfig) {}

  async login(): Promise<AuthContext> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/user-keys/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The key goes in the BODY (not a Bearer header). 307/308 preserve method AND
      // body, and cross-origin redirect protection only strips headers — so a
      // redirect here would replay the long-lived key to another origin.
      redirect: "manual",
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      body: JSON.stringify({ key: this.config.userKey }),
    });

    // With redirect:"manual" a 3xx is no longer followed, so name it for what it is
    // instead of blaming the credential.
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
      throw new Error(
        "MCP_API_BASE_URL redirected the credential exchange (HTTP " +
          `${res.status}). Point MCP_API_BASE_URL at the API root directly — a redirect ` +
          "would replay the user key to another origin, so it is never followed.",
      );
    }

    if (!res.ok) {
      throw new Error(`MCP_AUTH_USER_KEY rejected by /user-keys/session: HTTP ${res.status}`);
    }

    // Never let the parser's own error escape: on this endpoint the input it would
    // quote is the token payload.
    let body: { jwt?: string; token?: string };
    try {
      body = (await res.json()) as { jwt?: string; token?: string };
    } catch {
      throw new Error("/user-keys/session returned a body that is not valid JSON");
    }

    const token = body.jwt ?? body.token;
    if (!token) throw new Error("/user-keys/session response missing jwt field");

    return { token, expiresAt: jwtExpiryMs(token) };
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    // The user key is long-lived; refresh = exchange it again for a fresh session JWT.
    return this.login();
  }
}

const FALLBACK_TTL_MS = 23 * 3600_000;
/** Anything claiming to outlive this is not a session token — treat it as unparseable. */
const MAX_TTL_MS = 7 * 24 * 3600_000;

/**
 * Read the JWT `exp` (seconds) as epoch ms; fall back to now + 23 h if absent,
 * unparseable, or outside a plausible range.
 *
 * The range check is not paranoia (retro review 2026-09-02): the value was
 * previously returned verbatim, so a container clock ahead of the issuer made
 * every freshly minted token look already-expired — one key exchange per tool
 * call, silently, until the key got rate-limited — and an `exp` emitted in
 * milliseconds landed in the year 56000, so the token was never refreshed and
 * `new Date(expiresAt)` threw RangeError downstream.
 */
export function jwtExpiryMs(jwt: string): number {
  const now = Date.now();
  const fallback = now + FALLBACK_TTL_MS;
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) return fallback;

  let exp: unknown;
  try {
    ({ exp } = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8")) as { exp?: unknown });
  } catch {
    return fallback;
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) return fallback;

  const expiresAt = exp * 1000;
  // A token cannot genuinely be expired at the moment it was issued: that is clock
  // skew, and our own assumption is the better bet.
  if (expiresAt <= now) return fallback;
  if (expiresAt > now + MAX_TTL_MS) return fallback;
  return expiresAt;
}
