/**
 * JWT auth lifecycle (E3-03, FR-A-001..008, ADR-07).
 * Two flows: email/password (POST /session) and OpenID Connect (POST /openid/session).
 * Token cached in-memory; proactive refresh 60s before expiry.
 * 401 mid-call triggers single refresh-then-retry.
 */

export { AuthConfigError, detectAuthAdapter } from "./detect.js";
export { EmailPasswordAdapter } from "./email-password.js";
export { OpenIdAdapter } from "./openid.js";
export type { AuthContext, AuthSession } from "./session.js";
export { createAuthSession } from "./session.js";
