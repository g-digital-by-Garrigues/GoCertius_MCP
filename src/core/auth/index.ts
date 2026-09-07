/**
 * JWT auth lifecycle (E3-03, FR-A-001..008, ADR-07; service_account per ADR-A2).
 * Two adapters on one AuthSession port: user-key (POST /user-keys/session,
 * Epic E14) and service-account (OAuth2 client_credentials, ADR-A2).
 * Token cached in-memory; proactive refresh 60s before expiry.
 * 401 mid-call triggers single refresh-then-retry.
 *
 * The email/password adapter and the pre-seeded-JWT store are gone (STR-E18-02):
 * the products declare `authFlows: ["user-key"]`, and both removed paths carried
 * their own divergent expiry rule instead of the JWT's real `exp`.
 */

export { AuthConfigError, detectAuthAdapter } from "./detect.js";
export type { CallerProfile } from "./profile.js";
export { fetchCallerProfile, fetchCallerUserId } from "./profile.js";
export { ServiceAccountAdapter } from "./service-account.js";
export type { AuthContext, AuthSession } from "./session.js";
export { createAuthSession } from "./session.js";
export { jwtExpiryMs, UserKeyAdapter } from "./user-key.js";
