/**
 * Caller identity resolution (Epic E15, STR-E15-02).
 *
 * `GET /profile` returns the authenticated user's own profile and identifies the
 * caller from the session token alone. Its `id` field IS the userId (UUID) that
 * `/users/{userId}/...` operations require.
 *
 * This is the only identity path available on the user-key flow: `/session-info`
 * is keyed on the email, and a user-key deployment has no email to query with —
 * MCP_AUTH_USER_KEY is the only upstream user credential mcp-core accepts
 * (STR-E18-02).
 */
import { UpstreamHttpError } from "../errors/index.js";

/** Subset of ShowProfileRepresentation that callers rely on. `id` is required by the spec. */
export interface CallerProfile {
  /** The userId (UUID) required by case_file_list and every /users/{userId}/... operation. */
  id: string;
  email?: string;
  companyId?: string;
  /** The personal case file — the one chats must use. */
  defaultCaseFileId?: string;
  loginInfo?: { type?: string };
}

/** Upper bound on the identity lookup. Without it a hung endpoint blocks the caller. */
const PROFILE_TIMEOUT_MS = 15_000;

/**
 * Fetch the authenticated caller's profile.
 * Throws on a non-2xx response or a body without an `id`, so a caller never ends
 * up silently holding an undefined userId.
 *
 * Throws `UpstreamHttpError` rather than a plain Error (retro review 2026-09-02):
 * `isUnauthorizedError` — and therefore the one-shot refresh-and-retry every
 * generated tool gets — only recognises that class with a 401 status. With a plain
 * Error, `session_info` was the single tool in the server that could not self-heal
 * from an expired session.
 */
export async function fetchCallerProfile(baseUrl: string, jwt: string): Promise<CallerProfile> {
  if (!jwt) {
    throw new Error(
      "Could not resolve caller identity: no session token. Configure MCP_AUTH_USER_KEY " +
        "on the server, or send a Bearer token with the request.",
    );
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/profile`, {
    headers: { Authorization: `Bearer ${jwt}` },
    // A redirect would replay the Authorization header's bearer to another origin
    // for same-origin hops, so never follow one on a credentialed request.
    redirect: "manual",
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  });

  if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
    throw new UpstreamHttpError(
      res.status,
      `Could not resolve caller identity: GET /profile redirected (HTTP ${res.status}). ` +
        "Point MCP_API_BASE_URL at the API root directly — a redirect is never followed " +
        "on a credentialed request.",
    );
  }

  if (!res.ok) {
    throw new UpstreamHttpError(
      res.status,
      `Could not resolve caller identity: GET /profile returned HTTP ${res.status}`,
    );
  }

  let body: Partial<CallerProfile>;
  try {
    body = (await res.json()) as Partial<CallerProfile>;
  } catch {
    throw new UpstreamHttpError(
      res.status,
      "Could not resolve caller identity: GET /profile returned a body that is not valid JSON",
    );
  }

  if (typeof body.id !== "string" || body.id === "") {
    throw new UpstreamHttpError(
      res.status,
      "Could not resolve caller identity: GET /profile response has no `id` field",
    );
  }

  return body as CallerProfile;
}

/** Convenience wrapper: the caller's userId, straight from `GET /profile` → `id`. */
export async function fetchCallerUserId(baseUrl: string, jwt: string): Promise<string> {
  const profile = await fetchCallerProfile(baseUrl, jwt);
  return profile.id;
}
