/**
 * OpenID Connect auth adapter (AC2).
 * POST /openid/session → { jwt, expiresAt }
 */
import type { AuthAdapter, AuthContext } from "./session.js";

export interface OpenIdConfig {
  baseUrl: string;
  issuer: string;
  clientId: string;
  refreshToken: string;
}

export class OpenIdAdapter implements AuthAdapter {
  constructor(private readonly config: OpenIdConfig) {}

  async login(): Promise<AuthContext> {
    const res = await fetch(`${this.config.baseUrl}/openid/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issuer: this.config.issuer,
        client_id: this.config.clientId,
        refresh_token: this.config.refreshToken,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenID login failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      jwt?: string;
      token?: string;
      expires_at?: string;
      expiresAt?: number;
    };
    const token = body.jwt ?? body.token;
    if (!token) throw new Error("OpenID login response missing jwt field");

    const expiresAt = body.expires_at ? new Date(body.expires_at).getTime() : Date.now() + 3600_000;

    return { token, expiresAt };
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    return this.login();
  }
}
