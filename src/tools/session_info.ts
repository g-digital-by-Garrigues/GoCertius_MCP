// Custom tool: session_info — returns the caller's userId and session type.
//
// Two identity paths, because the auth flows are mutually exclusive (detect.ts):
//  - user key (no MCP_AUTH_EMAIL): GET /profile → `id` is the userId. The only
//    path available here — /session-info/{email} has no email to query with.
//  - email/password: GET /session-info/{email}, as before.
//
// Copied verbatim by the generator (AC3 override mechanism).
// n8n-http: GET /session-info/{email}
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { showSessionInfoControllerRun } from "../api/sdk.gen.js";
import { defineTool, fetchCallerProfile } from "../core/index.js";

const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

export const session_info = defineTool({
  name: "session_info",
  description:
    "Returns the authenticated user's session info including userId and session type (Password or UserKey). " +
    "Use this to retrieve the userId (UUID) required by case_file_list and other user-scoped operations. " +
    "Works on both auth flows: with a user key (MCP_AUTH_USER_KEY) it resolves identity via profile_get " +
    "(GET /profile → `id`), since no email is configured; with MCP_AUTH_EMAIL it queries /session-info. " +
    "profile_get is the canonical way to obtain the userId and returns more (companyId, defaultCaseFileId). " +
    "Prerequisites: a valid session (call session_login first if needed). " +
    "Example: session_info() → { userId: '...uuid...', type: 'Password' }",
  inputSchema: z.object({}),
  annotations: {
    title: "Session Info",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(_input, ctx) {
    const token = ctx.auth?.token ?? "";
    const email = process.env.MCP_AUTH_EMAIL ?? "";

    // User-key flow: no email is configured (detect.ts rejects combining the
    // flows), so /session-info/{email} is unreachable. GET /profile identifies
    // the caller from the session token alone; its `id` is the userId.
    if (!email) {
      const profile = await fetchCallerProfile(BASE_URL, token);
      return {
        userId: profile.id,
        type: "UserKey",
        email: profile.email ?? null,
        companyId: profile.companyId ?? null,
        defaultCaseFileId: profile.defaultCaseFileId ?? null,
      };
    }

    // Call the /session-info/{email} endpoint
    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const response = await showSessionInfoControllerRun({
      client: sdkClient,
      path: { email },
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null
          ? JSON.stringify(response.error)
          : String(response.error);
      throw new Error(`session_info API error: ${msg}`);
    }

    // Decode JWT payload to extract userId from sub claim
    const userId = extractUserIdFromJwt(token);

    // The real API may return userId in the response even though the spec omits it.
    // Merge it in either way so callers always get userId.
    const apiData = response.data as Record<string, unknown>;
    return {
      ...apiData,
      userId: apiData.userId ?? apiData.user_id ?? apiData.sub ?? userId ?? null,
    };
  },
});

/**
 * Decodes the payload section of a JWT (without verification) and returns
 * the `sub` claim, which GoCertius uses as the user UUID.
 */
function extractUserIdFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1] ?? "";
    // Add padding so atob / Buffer can decode it
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(padded, "base64").toString("utf-8")
        : atob(padded);
    const claims = JSON.parse(decoded) as Record<string, unknown>;
    const sub = claims.sub ?? claims.userId ?? claims.user_id;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}
