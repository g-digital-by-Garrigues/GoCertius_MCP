/**
 * Service-account auth adapter (OAuth2 client_credentials) — ADR-A2, FR-5..8.
 * Peer of EmailPasswordAdapter / UserKeyAdapter on the AuthSession port.
 * POST {tokenUrl} (form-encoded, HTTP Basic) → { access_token, expires_in }.
 *
 * Folds the legacy Okta client_credentials flow onto the suite port. Caching,
 * proactive refresh, and 401-retry are provided by AuthSession (do not duplicate here).
 * Secret hygiene (NFR-2): the client secret is sent via the Authorization: Basic
 * header and MUST never appear in a log line, thrown message, or request body.
 */
import type { AuthAdapter, AuthContext } from "./session.js";

export interface ServiceAccountConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Optional OAuth2 scope; sent only when set. */
  scope?: string;
}

const DEFAULT_EXPIRES_IN_S = 3600;

export class ServiceAccountAdapter implements AuthAdapter {
  constructor(private readonly config: ServiceAccountConfig) {}

  async login(): Promise<AuthContext> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.config.scope) params.set("scope", this.config.scope);

    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: params,
    });

    if (!res.ok) {
      // Never include the request body or secret in the error (NFR-2).
      throw new Error(`Service account token request failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };
    const token = body.access_token;
    if (!token) throw new Error("Service account token response missing access_token field");

    const expiresAt = Date.now() + (body.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000;

    return { token, expiresAt };
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    // client_credentials has no refresh_token — re-request a fresh token.
    return this.login();
  }
}
