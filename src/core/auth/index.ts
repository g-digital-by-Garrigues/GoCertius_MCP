/**
 * JWT auth lifecycle (E3-03, FR-A-001..008, ADR-07; service_account per ADR-A2).
 * Three adapters on one AuthSession port: email/password (POST /session),
 * OpenID Connect (POST /openid/session), and service-account (OAuth2 client_credentials).
 * Token cached in-memory; proactive refresh 60s before expiry.
 * 401 mid-call triggers single refresh-then-retry.
 */

export { AuthConfigError, detectAuthAdapter } from "./detect.js";
export { EmailPasswordAdapter } from "./email-password.js";
export { OpenIdAdapter } from "./openid.js";
export { ServiceAccountAdapter } from "./service-account.js";
export type { AuthContext, AuthSession } from "./session.js";
export { createAuthSession } from "./session.js";
