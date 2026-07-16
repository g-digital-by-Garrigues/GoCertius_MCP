/**
 * Inbound Bearer verification via OAuth2 token introspection (Story 2.3, RFC 7662, ADR-A2).
 *
 * Opt-in: enabled only when MCP_SVC_INTROSPECT_URL is set. Reuses the service-account
 * client credentials (MCP_SVC_CLIENT_ID/SECRET) as the resource-server's introspection
 * client — not a bespoke verifier. Secret is sent via Authorization: Basic and MUST
 * never be logged or echoed in an error.
 */
import { AuthConfigError, type AuthEnv } from "./detect.js";

export interface IntrospectionConfig {
  introspectUrl: string;
  clientId: string;
  clientSecret: string;
}

export class BearerIntrospector {
  constructor(private readonly config: IntrospectionConfig) {}

  /** True only when the introspection endpoint reports the token as active. */
  async isActive(token: string): Promise<boolean> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(this.config.introspectUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    });

    if (!res.ok) {
      // Surface as an error so the caller can fail closed (NFR-2). No secret in the message.
      throw new Error(`Token introspection request failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { active?: boolean };
    return body.active === true;
  }
}

/**
 * Build an inbound-Bearer verifier from env, or null when introspection is not configured
 * (MCP_SVC_INTROSPECT_URL unset → callers keep today's structural-only checks).
 * Throws AuthConfigError when the URL is set but the client credentials are missing.
 */
export function createBearerIntrospector(
  env: AuthEnv = process.env as AuthEnv,
): ((jwt: string) => Promise<boolean>) | null {
  const introspectUrl = env.MCP_SVC_INTROSPECT_URL;
  if (!introspectUrl) return null;

  if (!env.MCP_SVC_CLIENT_ID || !env.MCP_SVC_CLIENT_SECRET) {
    throw new AuthConfigError(
      "MCP_SVC_INTROSPECT_URL is set but MCP_SVC_CLIENT_ID and MCP_SVC_CLIENT_SECRET are required " +
        "to authenticate the introspection request.",
    );
  }

  const introspector = new BearerIntrospector({
    introspectUrl,
    clientId: env.MCP_SVC_CLIENT_ID,
    clientSecret: env.MCP_SVC_CLIENT_SECRET,
  });
  return (jwt: string) => introspector.isActive(jwt);
}
