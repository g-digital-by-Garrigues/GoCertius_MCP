/**
 * Credential detection: determines which auth flow to use from env vars.
 * AC6: Mixed vars from both flows → fast-fail with explicit error.
 */
import { DeviceFlowAdapter } from "./device-flow.js";
import { EmailPasswordAdapter } from "./email-password.js";
import { OpenIdAdapter } from "./openid.js";
import { ServiceAccountAdapter } from "./service-account.js";
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
  // Service-account flow (OAuth2 client_credentials, ADR-A2 / FR-5..8)
  MCP_SVC_TOKEN_URL?: string;
  MCP_SVC_CLIENT_ID?: string;
  MCP_SVC_CLIENT_SECRET?: string;
  MCP_SVC_SCOPE?: string;
  // Inbound Bearer introspection (RFC 7662, Story 2.3) — reuses the client id/secret above
  MCP_SVC_INTROSPECT_URL?: string;
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

  // Service-account flow (ADR-A2): all three of token URL + client id + secret required.
  const hasSvcTokenUrl = Boolean(env.MCP_SVC_TOKEN_URL);
  const hasSvcClientId = Boolean(env.MCP_SVC_CLIENT_ID);
  const hasSvcClientSecret = Boolean(env.MCP_SVC_CLIENT_SECRET);
  const hasSvcAny = hasSvcTokenUrl || hasSvcClientId || hasSvcClientSecret;
  const hasSvcFlow = hasSvcTokenUrl && hasSvcClientId && hasSvcClientSecret;

  // Conflict: service_account is mutually exclusive with the user-context flows.
  if (hasSvcAny && (hasEmail || hasPassword || hasIssuer || hasClientId || hasRefreshToken)) {
    throw new AuthConfigError(
      "Auth config conflict: service-account vars (MCP_SVC_*) cannot be combined with " +
        "email/password or OpenID vars. Configure exactly one auth flow. " +
        "Service account: MCP_SVC_TOKEN_URL + MCP_SVC_CLIENT_ID + MCP_SVC_CLIENT_SECRET (+ optional MCP_SVC_SCOPE).",
    );
  }

  // Service account: route to ServiceAccountAdapter; fail-fast on a partial set.
  if (hasSvcAny) {
    if (!hasSvcFlow) {
      const missing = [
        !hasSvcTokenUrl && "MCP_SVC_TOKEN_URL",
        !hasSvcClientId && "MCP_SVC_CLIENT_ID",
        !hasSvcClientSecret && "MCP_SVC_CLIENT_SECRET",
      ].filter(Boolean);
      throw new AuthConfigError(
        `Incomplete service-account config: ${missing.join(", ")} must be set ` +
          "(MCP_SVC_TOKEN_URL + MCP_SVC_CLIENT_ID + MCP_SVC_CLIENT_SECRET; MCP_SVC_SCOPE optional).",
      );
    }
    return new ServiceAccountAdapter({
      tokenUrl: env.MCP_SVC_TOKEN_URL!,
      clientId: env.MCP_SVC_CLIENT_ID!,
      clientSecret: env.MCP_SVC_CLIENT_SECRET!,
      ...(env.MCP_SVC_SCOPE ? { scope: env.MCP_SVC_SCOPE } : {}),
    });
  }

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
