// Custom tool: session_info — returns the caller's userId and how they are authenticated.
//
// One identity path (STR-E18-03): GET /profile → `id` is the userId. It is the only one
// available, and now the only one needed — /session-info/{email} was keyed on an email
// that a user-key deployment never has, and the user key is the sole upstream credential
// mcp-core accepts (STR-E18-02).
//
// Copied verbatim by the generator (AC3 override mechanism).
// n8n-http: GET /profile
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { defineTool, fetchCallerProfile } from "../core/index.js";

const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

export const session_info = defineTool({
  name: "session_info",
  description:
    "Returns who is authenticated: userId, email, companyId and defaultCaseFileId from GET " +
    "/profile; `type`, how this MCP session authenticated (always 'UserKey', the server's only " +
    "flow); and `accountLoginType`, a different fact: how the account itself signs in " +
    "('Password' or 'OpenId', from /profile, null if missing). Gives the userId that " +
    "case_file_list and other user-scoped tools need; profile_get is its canonical source and " +
    "returns the full profile. No parameters.",
  inputSchema: z.object({}),
  annotations: {
    title: "Session Info",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  // E22 (Hugo, 2026-11-27): read tools answer fresh — no result cache.
  idempotencyWindowSeconds: 0,
  async execute(_input, ctx) {
    const token = ctx.auth?.token ?? "";

    // GET /profile identifies the caller from the session token alone; its `id` is the
    // userId. Routed through `fetchCallerProfile` deliberately: it throws UpstreamHttpError,
    // the only class `isUnauthorizedError` recognises, which is what earns this tool the
    // one-shot refresh-and-retry every other tool gets (retro review 2026-09-02 — with a
    // hand-rolled fetch it was the single tool that could not self-heal from an expiry).
    const profile = await fetchCallerProfile(BASE_URL, token);

    return {
      userId: profile.id,
      // How THIS MCP session authenticated. A constant since STR-E18-03: the user key is
      // the server's only flow, so there is nothing left to infer (it used to be derived
      // from the absence of the retired email credential). Deliberately NOT sourced from
      // /profile's loginInfo.type, whose enum is ["Password","OpenId"] and has no
      // "UserKey" member — that field answers the next question down, not this one.
      type: "UserKey",
      // How the ACCOUNT signs in to the product: "Password" | "OpenId". Spec-required, but
      // read defensively — a missing loginInfo reports null rather than crashing the tool.
      accountLoginType: profile.loginInfo?.type ?? null,
      email: profile.email ?? null,
      companyId: profile.companyId ?? null,
      defaultCaseFileId: profile.defaultCaseFileId ?? null,
    };
  },
});
