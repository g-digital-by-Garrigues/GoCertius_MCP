// Custom tool: session_info — extends spec response with userId decoded from JWT sub claim.
// Copied verbatim by the generator (AC3 override mechanism).
// n8n-http: GET /session-info/{email}
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { showSessionInfoControllerRun } from "../api/sdk.gen.js";
import { defineTool } from "../core/index.js";

export const session_info = defineTool({
  name: "session_info",
  description:
    "Returns the authenticated user's session info including userId and session type (Password or UserKey). " +
    "Use this to retrieve the userId (UUID) required by case_file_list and other user-scoped operations. " +
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

    if (!email) {
      throw new Error("MCP_AUTH_EMAIL is not set — cannot determine which session to query.");
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
