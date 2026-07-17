// Custom tool: session_login — authenticates via user-key or email/password.
// n8n-http: POST /session
//
// Auth is normally automatic (the server detects credentials from the env and
// manages the session). Call this only to force a re-login or recover from a 401.
//
// Copied verbatim by the generator (AC3 override mechanism).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { deviceFlowStore } from "../core/auth/device-flow.js";
import { defineTool, fetchCallerUserId } from "../core/index.js";

const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

export const session_login = defineTool({
  name: "session_login",
  description:
    "Authenticate with GoCertius. Credentials are read from the server environment: " +
    "if MCP_AUTH_USER_KEY is set it is exchanged for a session token; otherwise " +
    "MCP_AUTH_EMAIL + MCP_AUTH_PASSWORD are used. The server manages authentication " +
    "automatically — call this only to force a re-login or after a 401.",
  inputSchema: z.object({}),
  annotations: {
    title: "Session Login",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 0,
  async execute(_input, _ctx) {
    const userKey = process.env.MCP_AUTH_USER_KEY;
    if (userKey) {
      return await runUserKeyFlow(userKey);
    }

    const email = process.env.MCP_AUTH_EMAIL;
    const password = process.env.MCP_AUTH_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "No credentials configured. Set MCP_AUTH_USER_KEY, or MCP_AUTH_EMAIL + MCP_AUTH_PASSWORD.",
      );
    }
    return await runPasswordFlow(email, password);
  },
});

// ── User key ────────────────────────────────────────────────────────────────
// Exchange the long-lived user key for a short-lived session JWT.

async function runUserKeyFlow(userKey: string) {
  const res = await fetch(`${BASE_URL}/user-keys/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The key goes in the BODY, not a Bearer header.
    body: JSON.stringify({ key: userKey }),
  });
  if (!res.ok) {
    throw new Error(`User-key login failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { jwt?: string; token?: string };
  const jwt = data.jwt ?? data.token;
  if (!jwt) throw new Error("User-key login response missing jwt field.");

  const expiresAt = jwtExpiryMs(jwt);
  deviceFlowStore.set(jwt, expiresAt);

  // Resolve the userId from GET /profile rather than the JWT `sub` claim: a
  // user-key session's claim set is not part of any contract we can rely on,
  // and a silently-undefined userId would break every /users/{userId}/... call
  // later, far from the cause. /profile.id is the documented source.
  const userId = await fetchCallerUserId(BASE_URL, jwt);

  return {
    authenticated: true,
    flow: "user-key",
    message: "Session is active.",
    userId,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

// ── Email / password ──────────────────────────────────────────────────────────

async function runPasswordFlow(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Password login failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { jwt?: string; token?: string };
  const jwt = data.jwt ?? data.token;
  if (!jwt) throw new Error("Password login response missing jwt field.");

  deviceFlowStore.set(jwt, Date.now() + 3_600_000);
  const userId = decodeJwtUserId(jwt);
  return { authenticated: true, flow: "email-password", message: "Session is active.", userId };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read the JWT `exp` (seconds) as epoch ms; fall back to now + 23 h if absent/unparseable. */
function jwtExpiryMs(jwt: string): number {
  const fallback = Date.now() + 23 * 3600_000;
  const b64 = jwt.split(".")[1];
  if (!b64) return fallback;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64").toString()) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}

function decodeJwtUserId(jwt: string): string | undefined {
  try {
    const b64 = jwt.split(".")[1];
    if (!b64) return undefined;
    const payload = JSON.parse(Buffer.from(b64, "base64").toString());
    return payload.sub ?? payload.userId ?? payload.id;
  } catch {
    return undefined;
  }
}
