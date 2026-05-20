/**
 * Credential detection: determines which auth flow to use from env vars.
 * AC6: Mixed vars from both flows → fast-fail with explicit error.
 */
import { EmailPasswordAdapter } from "./email-password.js";
import { OpenIdAdapter } from "./openid.js";
import type { AuthAdapter } from "./session.js";

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export interface AuthEnv {
  MCP_AUTH_EMAIL?: string;
  MCP_AUTH_PASSWORD?: string;
  MCP_OPENID_ISSUER?: string;
  MCP_OPENID_CLIENT_ID?: string;
  MCP_OPENID_REFRESH_TOKEN?: string;
  MCP_API_BASE_URL?: string;
}

export function detectAuthAdapter(env: AuthEnv = process.env as AuthEnv): AuthAdapter | null {
  const baseUrl = env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

  const hasEmail = Boolean(env.MCP_AUTH_EMAIL);
  const hasPassword = Boolean(env.MCP_AUTH_PASSWORD);
  const hasIssuer = Boolean(env.MCP_OPENID_ISSUER);
  const hasClientId = Boolean(env.MCP_OPENID_CLIENT_ID);
  const hasRefreshToken = Boolean(env.MCP_OPENID_REFRESH_TOKEN);

  const hasEmailFlow = hasEmail || hasPassword;
  const hasOpenIdFlow = hasIssuer || hasClientId || hasRefreshToken;

  // AC6: Both flows partially configured → error
  if (hasEmailFlow && hasOpenIdFlow) {
    throw new AuthConfigError(
      "Auth config conflict: both email/password and OpenID Connect vars are set. " +
        "Configure exactly one auth flow. " +
        "Email/password: MCP_AUTH_EMAIL + MCP_AUTH_PASSWORD. " +
        "OpenID: MCP_OPENID_ISSUER + MCP_OPENID_CLIENT_ID + MCP_OPENID_REFRESH_TOKEN.",
    );
  }

  if (hasEmailFlow) {
    if (!env.MCP_AUTH_EMAIL || !env.MCP_AUTH_PASSWORD) {
      throw new AuthConfigError(
        "Incomplete email/password config: both MCP_AUTH_EMAIL and MCP_AUTH_PASSWORD must be set.",
      );
    }
    return new EmailPasswordAdapter({
      baseUrl,
      email: env.MCP_AUTH_EMAIL,
      password: env.MCP_AUTH_PASSWORD,
    });
  }

  if (hasOpenIdFlow) {
    if (!env.MCP_OPENID_ISSUER || !env.MCP_OPENID_CLIENT_ID || !env.MCP_OPENID_REFRESH_TOKEN) {
      throw new AuthConfigError(
        "Incomplete OpenID config: MCP_OPENID_ISSUER, MCP_OPENID_CLIENT_ID, and MCP_OPENID_REFRESH_TOKEN must all be set.",
      );
    }
    return new OpenIdAdapter({
      baseUrl,
      issuer: env.MCP_OPENID_ISSUER,
      clientId: env.MCP_OPENID_CLIENT_ID,
      refreshToken: env.MCP_OPENID_REFRESH_TOKEN,
    });
  }

  // No credentials configured — server boots without auth (FR-E-013)
  return null;
}
