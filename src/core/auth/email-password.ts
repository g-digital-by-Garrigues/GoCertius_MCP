/**
 * Email/password auth adapter (AC1).
 * POST /session → { jwt, expiresAt }
 */
import type { AuthAdapter, AuthContext } from "./session.js";

export interface EmailPasswordConfig {
  baseUrl: string;
  email: string;
  password: string;
}

export class EmailPasswordAdapter implements AuthAdapter {
  constructor(private readonly config: EmailPasswordConfig) {}

  async login(): Promise<AuthContext> {
    const res = await fetch(`${this.config.baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`Login failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      jwt?: string;
      token?: string;
      expires_at?: string;
      expiresAt?: number;
    };
    const token = body.jwt ?? body.token;
    if (!token) throw new Error("Login response missing jwt field");

    const expiresAt = body.expires_at ? new Date(body.expires_at).getTime() : Date.now() + 3600_000; // default 1h

    return { token, expiresAt };
  }

  async refresh(_current: AuthContext): Promise<AuthContext> {
    // GoCertius session endpoint: re-login is the refresh mechanism
    return this.login();
  }
}
