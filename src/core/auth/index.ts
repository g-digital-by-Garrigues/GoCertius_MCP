/**
 * JWT auth lifecycle (E3-03, FR-A-001..008, ADR-07; service_account per ADR-A2).
 * Adapters on one AuthSession port: email/password (POST /session),
 * user-key (POST /user-keys/session, Epic E14), and service-account
 * (OAuth2 client_credentials). A pre-seeded MCP_AUTH_JWT is served via
 * DeviceFlowAdapter from the in-process token store.
 * Token cached in-memory; proactive refresh 60s before expiry.
 * 401 mid-call triggers single refresh-then-retry.
 */

export { AuthConfigError, detectAuthAdapter } from "./detect.js";
export { EmailPasswordAdapter } from "./email-password.js";
export type { CallerProfile } from "./profile.js";
export { fetchCallerProfile, fetchCallerUserId } from "./profile.js";
export { ServiceAccountAdapter } from "./service-account.js";
export type { AuthContext, AuthSession } from "./session.js";
export { createAuthSession } from "./session.js";
export { UserKeyAdapter } from "./user-key.js";
