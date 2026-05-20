/**
 * Credential detection: determines which auth flow to use from env vars.
 * AC6: Mixed vars from both flows → fast-fail with explicit error.
 */
import { DeviceFlowAdapter } from "./device-flow.js";
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
  MCP_AUTH_JWT?: string;
  MCP_OPENID_ISSUER?: string;
  MCP_OPENID_CLIENT_ID?: string;
  MCP_OPENID_REFRESH_TOKEN?: string;
  MCP_API_BASE_URL?: string;
}

export function detectAuthAdapter(env: AuthEnv = process.env as AuthEnv): AuthAdapter | null {
  const baseUrl = env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

  // MCP_AUTH_JWT: JWT pre-seeded directly (e.g. extracted from browser session).
  // Use DeviceFlowAdapter so authSession reads from deviceFlowStore (seeded in server.ts).
  if (env.MCP_AUTH_JWT) {
    return new DeviceFlowAdapter();
  }

  const hasEmail = Boolean(env.MCP_AUTH_EMAIL);
  const hasPassword = Boolean(env.MCP_AUTH_PASSWORD);
  const hasIssuer = Boolean(env.MCP_OPENID_ISSUER);
  const hasClientId = Boolean(env.MCP_OPENID_CLIENT_ID);
  const hasRefreshToken = Boolean(env.MCP_OPENID_REFRESH_TOKEN);

  // Email/password flow requires BOTH vars.
  // MCP_AUTH_EMAIL alone (no password, no OpenID vars) signals "auto-discovery" mode:
  // session_login will call /session-info/{email} to learn the auth type, issuer, and clientId.
  const hasEmailFlow = hasEmail && hasPassword;
  const hasOpenIdFlow = hasIssuer || hasClientId || hasRefreshToken;
  // Email-only: user provides just their address; session_login discovers issuer/clientId from API
  const hasEmailOnly = hasEmail && !hasPassword && !hasOpenIdFlow;

  // Conflict: explicit email/password AND explicit OpenID vars
  if (hasEmailFlow && hasOpenIdFlow) {
    throw new AuthConfigError(
      "Auth config conflict: both email/password and OpenID Connect vars are set. " +
        "Configure exactly one auth flow. " +
        "Email/password: MCP_AUTH_EMAIL + MCP_AUTH_PASSWORD. " +
        "OpenID (auto-discovery): MCP_AUTH_EMAIL only — issuer and clientId are fetched from GoCertius. " +
        "OpenID (headless): MCP_OPENID_ISSUER + MCP_OPENID_CLIENT_ID + MCP_OPENID_REFRESH_TOKEN.",
    );
  }

  if (hasEmailFlow) {
    // Both vars are guaranteed non-empty when hasEmailFlow is true
    return new EmailPasswordAdapter({
      baseUrl,
      email: env.MCP_AUTH_EMAIL!,
      password: env.MCP_AUTH_PASSWORD!,
    });
  }

  if (hasOpenIdFlow) {
    if (!env.MCP_OPENID_ISSUER || !env.MCP_OPENID_CLIENT_ID) {
      throw new AuthConfigError(
        "Incomplete OpenID config: MCP_OPENID_ISSUER and MCP_OPENID_CLIENT_ID must be set " +
          "(or use email-only mode: set only MCP_AUTH_EMAIL and call session_login).",
      );
    }
    // Device flow: ISSUER + CLIENT_ID without REFRESH_TOKEN → interactive Azure AD sign-in
    if (!env.MCP_OPENID_REFRESH_TOKEN) {
      return new DeviceFlowAdapter();
    }
    return new OpenIdAdapter({
      baseUrl,
      issuer: env.MCP_OPENID_ISSUER,
      clientId: env.MCP_OPENID_CLIENT_ID,
      refreshToken: env.MCP_OPENID_REFRESH_TOKEN,
    });
  }

  // Email-only mode: session_login auto-discovers issuer/clientId from /session-info/{email}
  // and stores the JWT in deviceFlowStore for all subsequent tool calls.
  if (hasEmailOnly) {
    return new DeviceFlowAdapter();
  }

  // No credentials configured — server boots without auth (FR-E-013)
  return null;
}
