/**
 * Credential detection: determines which auth flow to use from env vars.
 * Two flows only (STR-E18-02): user-key (MCP_AUTH_USER_KEY) and service-account
 * (MCP_SVC_TOKEN_URL + client id/secret).
 * Fast-fails when vars from more than one flow are mixed, when a flow is only
 * partially configured, and when a variable is present but blank.
 *
 * Fail-closed (retro review 2026-09-02): a *misconfiguration* throws
 * AuthConfigError and server.ts refuses to boot. Only a genuinely empty
 * environment returns null — that is FR-E-013 (public HTTP deployments carry no
 * server-side credentials and authenticate every request from its own Bearer).
 */
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
  // User-key flow (Epic E14): a single long-lived key exchanged for a session JWT.
  // The only upstream user-context credential mcp-core knows (STR-E18-02) — the
  // retired email/password pair and pre-seeded-JWT variable are now ordinary unknown
  // variables, so setting one boots a credential-less server rather than throwing: a
  // variable this package does not support cannot be a misconfiguration of it, and
  // keeping a permanent deny-list of once-supported names is the cost of the loud
  // alternative. Every auth-requiring tool still fails with missingCredentialsError.
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

/** Variables that configure an upstream user-context flow (STR-E18-02: exactly one). */
const USER_CONTEXT_VARS = ["MCP_AUTH_USER_KEY"] as const;

/**
 * The upstream API root for the flows that call it.
 *
 * Deliberately has NO default: mcp-core is shared by products on different hosts,
 * and a single default meant an EAD Enterprise Suite deployment without
 * MCP_API_BASE_URL sent its long-lived user key to the GoCertius host (retro
 * review 2026-09-02). Each product injects its own value.
 */
function requireBaseUrl(env: AuthEnv, flowVar: string): string {
  const baseUrl = env.MCP_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new AuthConfigError(
      `Auth config error: MCP_API_BASE_URL must be set — ${flowVar} authenticates against it. ` +
        "mcp-core carries no default host: credentials must never be sent to a guessed deployment.",
    );
  }
  return baseUrl;
}

export function detectAuthAdapter(env: AuthEnv = process.env as AuthEnv): AuthAdapter | null {
  // Present-but-blank is a misconfiguration, not "unset": an unresolved ${...} in a
  // compose file, or an emptied n8n credential field. Falling through to `return null`
  // booted an unauthenticated server whose remediation named the very variable that
  // WAS set (retro review 2026-09-02).
  const blank = USER_CONTEXT_VARS.filter(
    (name) => env[name] !== undefined && env[name]?.trim() === "",
  );
  if (blank.length > 0) {
    throw new AuthConfigError(
      `Auth config error: ${blank.join(", ")} is set but empty. Provide a value, or remove ` +
        "the variable entirely to run without upstream credentials (per-request Bearer only).",
    );
  }

  // The user key is opaque base64 and routinely arrives with copy-paste padding,
  // so it is trimmed before use.
  const userKey = env.MCP_AUTH_USER_KEY?.trim();
  const hasUserKey = Boolean(userKey);

  // Service-account flow (ADR-A2): all three of token URL + client id + secret required.
  //
  // MCP_SVC_TOKEN_URL is what identifies this flow. MCP_SVC_CLIENT_ID/SECRET are
  // deliberately NOT part of the test: they are SHARED with inbound RFC 7662
  // introspection (MCP_SVC_INTROSPECT_URL), which MCP_HTTP_PUBLIC=true requires.
  // Keying on "any MCP_SVC_* var" made those two concerns collide — configuring
  // introspection on a gocertius/suite deployment either conflicted with its
  // user-key flow or tripped the incomplete-set check, and the resulting
  // AuthConfigError was swallowed by server.ts, so the server booted looking
  // healthy while every upstream call went out unauthenticated (STR-E15-04; the
  // original story text said "refused to start", corrected in the epic doc).
  const hasSvcTokenUrl = Boolean(env.MCP_SVC_TOKEN_URL);
  const hasSvcClientId = Boolean(env.MCP_SVC_CLIENT_ID);
  const hasSvcClientSecret = Boolean(env.MCP_SVC_CLIENT_SECRET);
  const hasSvcIntrospectUrl = Boolean(env.MCP_SVC_INTROSPECT_URL);
  const hasSvcFlow = hasSvcTokenUrl && hasSvcClientId && hasSvcClientSecret;

  // Conflict: service_account is mutually exclusive with the user-context flow.
  if (hasSvcTokenUrl && hasUserKey) {
    throw new AuthConfigError(
      "Auth config conflict: MCP_SVC_TOKEN_URL (service-account flow) cannot be combined " +
        "with MCP_AUTH_USER_KEY. Configure exactly one auth flow. " +
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

  // Outbound service account missing only its token URL. The shared client
  // id/secret are legitimate on their own ONLY when they serve inbound
  // introspection, so this fires exclusively when neither MCP_SVC_TOKEN_URL nor
  // MCP_SVC_INTROSPECT_URL is set and no user-context flow is configured either.
  // Restores the named diagnostic that keying detection on MCP_SVC_TOKEN_URL
  // alone dropped — STR-E15-04 AC8 regression, and EAD Factory's only flow.
  if (hasSvcClientId && hasSvcClientSecret && !hasSvcIntrospectUrl && !hasUserKey) {
    throw new AuthConfigError(
      "Incomplete service-account config: MCP_SVC_TOKEN_URL must be set " +
        "(MCP_SVC_TOKEN_URL + MCP_SVC_CLIENT_ID + MCP_SVC_CLIENT_SECRET; MCP_SVC_SCOPE optional). " +
        "If these credentials are meant for inbound Bearer introspection instead, set MCP_SVC_INTROSPECT_URL.",
    );
  }

  // User-key flow (Epic E14): a single long-lived key, exchanged for a session JWT.
  // The only user-context flow (STR-E18-02), so there is no sibling to conflict with
  // — the exclusivity check above is against the service account.
  if (userKey) {
    return new UserKeyAdapter({
      baseUrl: requireBaseUrl(env, "MCP_AUTH_USER_KEY"),
      userKey,
    });
  }

  // No credentials configured at all — server boots without upstream auth (FR-E-013).
  // Intentional: public HTTP deployments authenticate each request from its own Bearer.
  return null;
}
