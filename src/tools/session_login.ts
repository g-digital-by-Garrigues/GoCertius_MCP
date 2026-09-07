// Custom tool: session_login — forces the server to re-exchange its configured user key.
// n8n-http: POST /user-keys/session
//
// Auth is normally automatic (the server detects MCP_AUTH_USER_KEY in its environment
// and manages the session). Call this only to force a re-login or recover from a 401.
//
// STR-E18-03: this tool no longer performs the credential exchange itself. It used to
// POST /user-keys/session with its own `fetch` and stash the result in mcp-core's
// in-process token store, whose only reader STR-E18-02 deleted — so the call burned the
// long-lived key against the auth endpoint and changed nothing about the session the
// server actually uses. It now delegates to `ctx.reauthenticate`, which drives
// the process-wide `AuthSession`: one implementation of the exchange, with its single-flight
// guard, its cache (the token it returns IS what later calls use) and `jwtExpiryMs`'s expiry
// clamp. A tool must never mint or store a session token of its own.
//
// Copied verbatim by the generator (AC3 override mechanism).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { defineTool, fetchCallerUserId } from "../core/index.js";

const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

export const session_login = defineTool({
  name: "session_login",
  description:
    "Force the GoCertius MCP server to re-authenticate. Takes no parameters and accepts no " +
    "credentials: the server re-exchanges the user key it was configured with " +
    "(MCP_AUTH_USER_KEY) for a fresh session token, and this tool reports the resulting " +
    "userId and expiry. The server manages authentication automatically — call this only " +
    "to force a re-login or after a 401.",
  inputSchema: z.object({}),
  annotations: {
    title: "Session Login",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  // STR-E18-04: this tool acts ON the server's own credential session instead of using
  // it. mcp-core reads the flag to skip token injection and the 401 retry, to exempt the
  // tool from the missing-credentials fail-soft, and — because a shared multi-tenant HTTP
  // server (MCP_HTTP_PUBLIC=true) holds no session on any caller's behalf — to not
  // register the tool at all in that mode.
  operatesOnServerSession: true,
  idempotencyWindowSeconds: 0,
  async execute(_input, ctx) {
    // STR-E18-03: the capability is OPTIONAL — mcp-core omits it when the server owns no
    // session to act on: a credential-less boot (FR-E-013), or HTTP mode where the caller
    // supplied its own Bearer. Check it explicitly so that case is a structured, actionable
    // error instead of a TypeError from calling an absent member.
    if (!ctx.reauthenticate) {
      // ctx.toolError, never a bare `throw new Error`: an unclassified Error falls
      // into mapUpstreamError's network catch-all, which frames it as "a transient
      // failure — retry in a moment". This is a PERMANENT configuration fault, and
      // telling an agent to retry it produces exactly the retry loop that re-exchanges
      // a credential on every attempt (retro review 2026-09-02).
      // `return` is load-bearing: toolError is typed `never` but it is a METHOD, so
      // TypeScript does not treat a bare call as a control-flow terminator and
      // ctx.reauthenticate stays possibly-undefined below (caught by tsc on the
      // EMITTED tree, which is the only compiler that sees this file resolved).
      return ctx.toolError({
        operation: "session_login",
        upstream: new Error(
          "No server-managed session to re-authenticate: this server holds no credential of its own.",
        ),
        remediation:
          "Set MCP_AUTH_USER_KEY in the server environment. If you are calling over HTTP with " +
          "your own Bearer token, that token is yours to renew — this server has no session to " +
          "re-exchange; use session_info or profile_get to see who you are.",
      });
    }

    // The shared AuthSession owns the token: it performs the single POST /user-keys/session,
    // caches the result and clamps the expiry. `token` is already live for every other tool,
    // so it is used directly below rather than exchanged a second time.
    //
    // Failures are re-framed rather than propagated: AuthSession throws a plain Error
    // ("Auth failed after 3 attempts: ..."), which mapUpstreamError classifies as a
    // network fault and advertises as "transient — retry in a moment". A rejected or
    // expired user key is neither transient nor retryable, and AuthSession has ALREADY
    // retried three times — so that advice makes an agent re-exchange a 12-month
    // credential in a loop, which is the auth-endpoint rate-limit shape the E15 retro
    // exists to prevent.
    let token: string;
    let expiresAt: number;
    try {
      ({ token, expiresAt } = await ctx.reauthenticate());
    } catch (err) {
      return ctx.toolError({
        operation: "session_login",
        upstream: err,
        remediation:
          "The server already retried three times, so this will not clear on its own: check " +
          "that MCP_AUTH_USER_KEY is current (user keys expire and can be revoked) and that " +
          "MCP_API_BASE_URL points at the right API root. Do not call session_login in a loop.",
      });
    }

    // Resolve the userId from GET /profile rather than the JWT `sub` claim: a user-key
    // session's claim set is not part of any contract we can rely on, and a silently
    // undefined userId would break every /users/{userId}/... call later, far from the
    // cause. /profile.id is the documented source.
    //
    // Identity resolution must not be able to fail a login that already succeeded
    // (retro review 2026-09-02): the session is re-established by this point, so throwing
    // here reported failure for a working session, and an agent that retries on error
    // re-exchanged the long-lived key on every attempt. The failure is surfaced explicitly
    // instead — never a silent undefined userId.
    let userId: string | undefined;
    let identityError: string | undefined;
    try {
      userId = await fetchCallerUserId(BASE_URL, token);
    } catch (err) {
      identityError = err instanceof Error ? err.message : String(err);
    }

    return {
      authenticated: true,
      // The only upstream credential this product accepts (product config authFlows).
      flow: "user-key",
      message: identityError
        ? "Session is active, but the caller identity could not be resolved — retry `session_info` or `profile_get`."
        : "Session is active.",
      ...(userId ? { userId } : {}),
      ...(identityError ? { identityError } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  },
});
