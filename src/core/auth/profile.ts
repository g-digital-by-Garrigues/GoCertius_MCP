/**
 * Caller identity resolution (Epic E15, STR-E15-02).
 *
 * `GET /profile` returns the authenticated user's own profile and identifies the
 * caller from the session token alone. Its `id` field IS the userId (UUID) that
 * `/users/{userId}/...` operations require.
 *
 * This is the only identity path available on the user-key flow: `/session-info`
 * is keyed on the email, and detectAuthAdapter forbids MCP_AUTH_EMAIL whenever
 * MCP_AUTH_USER_KEY is set — so a user-key deployment has no email to query with.
 */

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

/**
 * Fetch the authenticated caller's profile.
 * Throws on a non-2xx response or a body without an `id`, so a caller never ends
 * up silently holding an undefined userId.
 */
export async function fetchCallerProfile(baseUrl: string, jwt: string): Promise<CallerProfile> {
  const res = await fetch(`${baseUrl}/profile`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    throw new Error(`Could not resolve caller identity: GET /profile returned HTTP ${res.status}`);
  }

  const body = (await res.json()) as Partial<CallerProfile>;
  if (typeof body.id !== "string" || body.id === "") {
    throw new Error("Could not resolve caller identity: GET /profile response has no `id` field");
  }

  return body as CallerProfile;
}

/** Convenience wrapper: the caller's userId, straight from `GET /profile` → `id`. */
export async function fetchCallerUserId(baseUrl: string, jwt: string): Promise<string> {
  const profile = await fetchCallerProfile(baseUrl, jwt);
  return profile.id;
}
