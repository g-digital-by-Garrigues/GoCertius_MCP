/**
 * Credential detection: determines which auth flow to use from env vars.
 * Fast-fails when vars from more than one flow are mixed.
 */
import { DeviceFlowAdapter } from "./device-flow.js";
import { EmailPasswordAdapter } from "./email-password.js";
import { ServiceAccountAdapter } from "./service-account.js";
import type { AuthAdapter } from "./session.js";
import { UserKeyAdapter } from "./user-key.js";

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
  // User-key flow (Epic E14): a single long-lived key exchanged for a session JWT
  MCP_AUTH_USER_KEY?: string;
  MCP_API_BASE_URL?: string;
  // OUTBOUND service-account flow (OAuth2 client_credentials, ADR-A2 / FR-5..8).
  // MCP_SVC_TOKEN_URL is exclusive to this flow and is what selects it.
  MCP_SVC_TOKEN_URL?: string;
  MCP_SVC_SCOPE?: string;
  // SHARED credentials: used by the outbound flow above AND by inbound introspection
  // below. Never treat them on their own as a service-account flow (STR-E15-04).
  MCP_SVC_CLIENT_ID?: string;
  MCP_SVC_CLIENT_SECRET?: string;
  // INBOUND Bearer introspection (RFC 7662, Story 2.3) — a transport concern, not an
  // auth flow. Required by MCP_HTTP_PUBLIC=true; reuses the client id/secret above.
  MCP_SVC_INTROSPECT_URL?: string;
}

export function detectAuthAdapter(env: AuthEnv = process.env as AuthEnv): AuthAdapter | null {
  const baseUrl = env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

  // MCP_AUTH_JWT: JWT pre-seeded directly (e.g. extracted from a browser session).
  // Use DeviceFlowAdapter so authSession reads from deviceFlowStore (seeded in server.ts).
  if (env.MCP_AUTH_JWT) {
    return new DeviceFlowAdapter();
  }

  const hasEmail = Boolean(env.MCP_AUTH_EMAIL);
  const hasPassword = Boolean(env.MCP_AUTH_PASSWORD);
  const hasUserKey = Boolean(env.MCP_AUTH_USER_KEY);

  // Service-account flow (ADR-A2): all three of token URL + client id + secret required.
  //
  // MCP_SVC_TOKEN_URL is what identifies this flow. MCP_SVC_CLIENT_ID/SECRET are
  // deliberately NOT part of the test: they are SHARED with inbound RFC 7662
  // introspection (MCP_SVC_INTROSPECT_URL), which MCP_HTTP_PUBLIC=true requires.
  // Keying on "any MCP_SVC_* var" made those two concerns collide — configuring
  // introspection on a gocertius/suite deployment either conflicted with its
  // email/user-key flow or tripped the incomplete-set check, so the server
  // refused to start and public HTTP mode was unusable there (STR-E15-04).
  const hasSvcTokenUrl = Boolean(env.MCP_SVC_TOKEN_URL);
  const hasSvcClientId = Boolean(env.MCP_SVC_CLIENT_ID);
  const hasSvcClientSecret = Boolean(env.MCP_SVC_CLIENT_SECRET);
  const hasSvcFlow = hasSvcTokenUrl && hasSvcClientId && hasSvcClientSecret;

  // Conflict: service_account is mutually exclusive with the user-context flows.
  if (hasSvcTokenUrl && (hasEmail || hasPassword || hasUserKey)) {
    throw new AuthConfigError(
      "Auth config conflict: the service-account flow (MCP_SVC_TOKEN_URL) cannot be combined " +
        "with email/password or user-key vars. Configure exactly one auth flow. " +
        "Service account: MCP_SVC_TOKEN_URL + MCP_SVC_CLIENT_ID + MCP_SVC_CLIENT_SECRET (+ optional MCP_SVC_SCOPE). " +
        "Note: MCP_SVC_CLIENT_ID/MCP_SVC_CLIENT_SECRET on their own are fine — they double as " +
        "inbound introspection credentials (MCP_SVC_INTROSPECT_URL) and do not select this flow.",
    );
  }

  // Service account: route to ServiceAccountAdapter; fail-fast on a partial set.
  if (hasSvcTokenUrl) {
    if (!hasSvcFlow) {
      const missing = [
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

  // User-key flow (Epic E14): a single long-lived key, exchanged for a session JWT.
  // Mutually exclusive with the other user-context flows.
  if (hasUserKey) {
    if (hasEmail || hasPassword) {
      throw new AuthConfigError(
        "Auth config conflict: MCP_AUTH_USER_KEY cannot be combined with email/password vars. " +
          "Configure exactly one auth flow.",
      );
    }
    return new UserKeyAdapter({ baseUrl, userKey: env.MCP_AUTH_USER_KEY! });
  }

  // Email/password flow requires BOTH vars.
  const hasEmailFlow = hasEmail && hasPassword;
  if (hasEmailFlow) {
    return new EmailPasswordAdapter({
      baseUrl,
      email: env.MCP_AUTH_EMAIL!,
      password: env.MCP_AUTH_PASSWORD!,
    });
  }

  // No credentials configured — server boots without auth (FR-E-013).
  return null;
}
