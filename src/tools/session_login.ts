// Custom tool: session_login — discovers auth type via /session-info/{email},
// then routes to email/password or Azure AD device flow accordingly.
//
// Azure AD device flow uses a TWO-STEP pattern to avoid elicitation:
//   Step 1: Call session_login → returns verificationUri + userCode, stores device_code in memory.
//   Step 2: User approves in Authenticator, then calls session_login again → polls Azure AD → done.
//
// Copied verbatim by the generator (AC3 override mechanism).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { deviceFlowStore } from "../core/auth/device-flow.js";
import { defineTool } from "../core/index.js";
import { z } from "zod";

const POLL_MAX_ATTEMPTS = 6;   // ~30 s per call (6 × 5 s); user calls again if not yet approved
const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";

// ── Pending device flow store ─────────────────────────────────────────────────
// Process-level singleton: set on Step 1, cleared on Step 2 success or expiry.
interface PendingDeviceFlow {
  issuer: string;
  clientId: string;
  deviceCode: string;
  expiresAt: number;
  interval: number;
}
let pendingDeviceFlow: PendingDeviceFlow | null = null;

export const session_login = defineTool({
  name: "session_login",
  description:
    "Authenticate with GoCertius. " +
    "Reads MCP_AUTH_EMAIL to discover the auth type (Password or OpenId) for that account. " +
    "For Password accounts: uses MCP_AUTH_PASSWORD to obtain a session JWT. " +
    "For OpenId accounts: starts an Azure AD device flow — on the FIRST call returns a browser link " +
    "and code for the user to approve with Microsoft Authenticator; call session_login AGAIN after " +
    "approving to complete authentication.",
  inputSchema: z.object({}),
  annotations: { destructive: false, idempotent: false, requiresUserConfirmation: false },
  pollable: false,
  idempotencyWindowSeconds: 0,
  async execute(_input, _ctx) {
    const email = process.env.MCP_AUTH_EMAIL;
    const password = process.env.MCP_AUTH_PASSWORD;

    if (!email) {
      throw new Error(
        "MCP_AUTH_EMAIL is required — set it to your GoCertius account email.",
      );
    }

    // Step 2: If a device flow is already pending, poll Azure AD for the token.
    if (pendingDeviceFlow && Date.now() < pendingDeviceFlow.expiresAt) {
      return await pollPendingDeviceFlow();
    }
    // Clear expired pending flow
    pendingDeviceFlow = null;

    // Step 1: Discover auth type for this email
    const infoRes = await fetch(`${BASE_URL}/session-info/${encodeURIComponent(email)}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!infoRes.ok) {
      throw new Error(`session-info lookup failed: HTTP ${infoRes.status}`);
    }
    const info = (await infoRes.json()) as {
      type: "Password" | "OpenId";
      issuer?: string;
      clientId?: string;
      scope?: string[];
    };

    // Route based on auth type
    if (info.type === "Password") {
      if (!password) {
        throw new Error(
          "Account uses Password auth — set MCP_AUTH_PASSWORD in your server config.",
        );
      }
      return await runPasswordFlow(email, password);
    }

    if (info.type === "OpenId") {
      const issuer = process.env.MCP_OPENID_ISSUER ?? info.issuer;
      const clientId = process.env.MCP_OPENID_CLIENT_ID ?? info.clientId;
      const refreshToken = process.env.MCP_OPENID_REFRESH_TOKEN;
      const scope =
        process.env.MCP_OPENID_SCOPE ?? info.scope?.join(" ") ?? "openid offline_access";

      if (!issuer || !clientId) {
        throw new Error(
          "Account uses OpenId auth but issuer/clientId could not be determined. " +
            "Check that /session-info returns them, or set MCP_OPENID_ISSUER and MCP_OPENID_CLIENT_ID.",
        );
      }

      // Headless: exchange pre-configured refresh token directly
      if (refreshToken) {
        return await runRefreshTokenFlow({ issuer, clientId, refreshToken, scope });
      }

      // Interactive: Azure AD device flow (two-step, no elicitation)
      return await startAzureDeviceFlow({ issuer, clientId, scope });
    }

    throw new Error(`Unknown auth type from session-info: ${(info as any).type}`);
  },
});

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

// ── OpenId refresh token ──────────────────────────────────────────────────────

async function runRefreshTokenFlow({
  issuer,
  clientId,
  refreshToken,
  scope,
}: {
  issuer: string;
  clientId: string;
  refreshToken: string;
  scope: string;
}) {
  const tokenRes = await fetch(`${issuer}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      scope,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Azure AD refresh token exchange failed: HTTP ${tokenRes.status}`);
  }
  const msToken = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  return await exchangeForGoCertiusJwt({
    issuer,
    clientId,
    accessToken: msToken.access_token,
    refreshToken: msToken.refresh_token,
  });
}

// ── Azure AD device flow — Step 1: initiate ───────────────────────────────────

async function startAzureDeviceFlow({
  issuer,
  clientId,
  scope,
}: {
  issuer: string;
  clientId: string;
  scope: string;
}) {
  const dcRes = await fetch(`${issuer}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope }).toString(),
  });
  if (!dcRes.ok) throw new Error(`Azure AD device code request failed: HTTP ${dcRes.status}`);

  const dc = (await dcRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  // Store for Step 2
  pendingDeviceFlow = {
    issuer,
    clientId,
    deviceCode: dc.device_code,
    expiresAt: Date.now() + dc.expires_in * 1_000,
    interval: (dc.interval ?? 5) * 1_000,
  };

  return {
    action: "device_flow_pending",
    message:
      `Azure AD sign-in required.\n\n` +
      `1. Visit: ${dc.verification_uri}\n` +
      `2. Enter code: ${dc.user_code}\n` +
      `3. Approve with Microsoft Authenticator\n\n` +
      `After approving, call session_login again to complete authentication.`,
    verificationUri: dc.verification_uri,
    userCode: dc.user_code,
    expiresInSeconds: dc.expires_in,
  };
}

// ── Azure AD device flow — Step 2: poll ──────────────────────────────────────

async function pollPendingDeviceFlow() {
  const flow = pendingDeviceFlow!;

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(flow.interval);

    const tokenRes = await fetch(`${flow.issuer}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: flow.clientId,
        device_code: flow.deviceCode,
      }).toString(),
    });

    if (tokenRes.ok) {
      const msToken = (await tokenRes.json()) as { access_token: string; refresh_token?: string };
      pendingDeviceFlow = null;
      return await exchangeForGoCertiusJwt({
        issuer: flow.issuer,
        clientId: flow.clientId,
        accessToken: msToken.access_token,
        refreshToken: msToken.refresh_token,
      });
    }

    const err = (await tokenRes.json()) as { error?: string };
    if (err.error === "authorization_pending") continue;
    if (err.error === "slow_down") { await sleep(flow.interval); continue; }
    pendingDeviceFlow = null;
    throw new Error(`Azure AD token error: ${err.error ?? "unknown"}`);
  }

  // Still pending — tell user to call again
  return {
    action: "device_flow_pending",
    message:
      "Still waiting for approval. Call session_login again after approving in Microsoft Authenticator.",
  };
}

// ── Exchange Azure token → GoCertius JWT ──────────────────────────────────────

async function exchangeForGoCertiusJwt({
  issuer,
  clientId,
  accessToken,
  refreshToken,
}: {
  issuer: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
}) {
  const gcRes = await fetch(`${BASE_URL}/openid/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      issuer,
      client_id: clientId,
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    }),
  });
  if (!gcRes.ok) {
    const body = await gcRes.text();
    throw new Error(`GoCertius OpenID session failed: HTTP ${gcRes.status} — ${body}`);
  }
  const gcSession = (await gcRes.json()) as { jwt?: string; token?: string; expires_at?: string };
  const jwt = gcSession.jwt ?? gcSession.token;
  if (!jwt) throw new Error("GoCertius OpenID session response missing jwt field.");

  const expiresAt = gcSession.expires_at
    ? new Date(gcSession.expires_at).getTime()
    : Date.now() + 3_600_000;

  deviceFlowStore.set(jwt, expiresAt);
  const userId = decodeJwtUserId(jwt);

  return {
    authenticated: true,
    flow: "azure-ad-device-flow",
    message: "Azure AD sign-in successful. GoCertius session is now active.",
    expiresAt: new Date(expiresAt).toISOString(),
    userId,
  };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
