# GoCertius MCP Server

[![npm version](https://img.shields.io/npm/v/@g-digital/mcp-gocertius)](https://www.npmjs.com/package/@g-digital/mcp-gocertius)
[![npm downloads](https://img.shields.io/npm/dm/@g-digital/mcp-gocertius)](https://www.npmjs.com/package/@g-digital/mcp-gocertius)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![provenance](https://img.shields.io/badge/npm-provenance-green)](https://www.npmjs.com/package/@g-digital/mcp-gocertius)
[![smithery badge](https://smithery.ai/badge/g-digital/gocertius)](https://smithery.ai/servers/g-digital/gocertius)

MCP server for GoCertius, EAD Trust's Digital Trust platform. Provides certified evidence management, dossier creation, certified notifications, and certified chats via AI agents.

## Quick start

```bash
npx -y @g-digital/mcp-gocertius
```

Or see [ONBOARDING.md](ONBOARDING.md) for a step-by-step setup guide (≤ 5 minutes).

## Where to install

This MCP is published to every major MCP distribution channel by the [g-digital MCP distribution pipeline](https://github.com/g-digital-by-Garrigues/MCP_Market_Distribution). Pick whichever fits your stack:

| Channel | Install command / URL |
|---|---|
| **npm** | `npx -y @g-digital/mcp-gocertius` — [npmjs.com/package/@g-digital/mcp-gocertius](https://www.npmjs.com/package/@g-digital/mcp-gocertius) |
| **Docker Hub** | `docker pull gdigital/gocertius:latest` — [hub.docker.com/r/gdigital/gocertius](https://hub.docker.com/r/gdigital/gocertius) |
| **MCP Official Registry** | Auto-discovered as `io.github.g-digital-by-Garrigues/gocertius` by any client that reads the registry — [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/v0/servers/io.github.g-digital-by-Garrigues/gocertius) |
| **n8n community node** | In n8n Settings → Community Nodes → install `@g-digital/n8n-nodes-gocertius` (works with the AI Agent node via `usableAsTool`) — [npmjs.com/package/@g-digital/n8n-nodes-gocertius](https://www.npmjs.com/package/@g-digital/n8n-nodes-gocertius) |
| **Smithery** | `smithery mcp install g-digital/gocertius` (from v1.0.7) — [smithery.ai/servers/g-digital/gocertius](https://smithery.ai/servers/g-digital/gocertius) |

Every channel ships the same MCP server contract; the tools and env-var configuration below apply regardless of which install path you choose.

## Installation

<!-- INSTALL_BLOCKS -->

### Claude Desktop / Claude Code

Add to your `~/.claude.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gocertius": {
      "command": "npx",
      "args": ["-y", "@g-digital/mcp-gocertius"],
      "env": {
        "MCP_AUTH_EMAIL": "your-email@example.com",
        "MCP_AUTH_PASSWORD": "your-password"
      }
    }
  }
}
```

### Docker

```bash
docker run --rm -i \
  -e MCP_AUTH_EMAIL=your-email@example.com \
  -e MCP_AUTH_PASSWORD=your-password \
  gdigital/gocertius:latest
```

## Environment Variables

<!-- ENV_VARS -->

| Variable | Required | Description |
|---|---|---|
| `MCP_AUTH_EMAIL` | One of flow 1 or 2 | Your account email |
| `MCP_AUTH_PASSWORD` | One of flow 1 or 2 | Your account password |
| `MCP_OPENID_ISSUER` | One of flow 1 or 2 | OpenID Connect issuer URL |
| `MCP_OPENID_CLIENT_ID` | One of flow 1 or 2 | OpenID Connect client ID |
| `MCP_OPENID_REFRESH_TOKEN` | One of flow 1 or 2 | OpenID Connect refresh token |
| `MCP_AUTH_JWT` | Optional | Pre-seeded JWT (skips interactive login) |
| `MCP_OTEL_ENABLED` | Optional | Set to `true` to enable OpenTelemetry tracing |
| `MCP_API_BASE_URL` | Optional | Override upstream API base URL |

For credential setup instructions, visit: [https://www.gocertius.io](https://www.gocertius.io)

## Bundled Skills

This package ships Claude Code slash-commands under `.claude/commands/`. After install, invoke them from Claude Code:

- `/getting-started` — authentication, finding your case file, generating valid UUIDs
- `/evidence-lifecycle` — certified evidence creation and sealing
- `/dossier-lifecycle` — certified dossier creation (express and full flow)
- `/notification-lifecycle` — certified notification delivery
- `/chat-lifecycle` — certified Telegram chat and certificate generation

See [docs/agent-prompts.md](docs/agent-prompts.md) for end-to-end prompt examples and the tool sequences they trigger.

## Available Tools

This server exposes **28 tools**:

| Tool | Description |
|------|-------------|
| `evidence_create` | Add a file to an open evidence group. Returns a presigned S3 upload URL for INTERNAL custody; records only the hash for EXTERNAL. |
| `evidence_list` | List all evidence items in an evidence group, filterable by status, date range, and type. |
| `evidence_seal` | Seal and certify an evidence group (long-running MCP task). Closes the group and timestamps all contained evidence. |
| `evidence_get` | Get full details of a single evidence item including status, hash, and custody type. |
| `evidence_group_create` | Create a new open evidence group. Type can be FILE, PHOTO, VIDEO, or WEB_PLUGIN. |
| `evidence_group_list` | List all evidence groups in a case file with their current status and evidence counts. |
| `dossier_create` | Create a DRAFT dossier. Link evidences via `dossier_evidence_link` then certify with `dossier_certify`. |
| `dossier_list` | List dossiers in a case file, filterable by status (DRAFT, CERTIFYING, CERTIFIED). |
| `dossier_get` | Get a dossier's details including the certified PDF download URL once CERTIFIED. |
| `dossier_template_list` | List available dossier templates. |
| `notification_request_create` | Create a certified notification request in DRAFT status. Add recipients then call `notification_request_send`. |
| `notification_request_send` | Trigger delivery of a certified notification to all recipients (long-running MCP task — waits for DELIVERED). |
| `notification_request_status` | Get the current status and receiver statistics of a notification request. |
| `notification_receiver_add` | Add a recipient to a DRAFT notification request. Supports optional SMS OTP per recipient. |
| `notification_certificate_get` | Generate or retrieve the legal delivery certificate for a specific notification receiver. |
| `case_file_create` | Create a new case file (workspace) for organizing documents and processes. Requires a `useCaseId`. |
| `case_file_list` | List case files accessible to a user. Requires the `userId` returned by `session_login`. |
| `case_file_get` | Get details of a specific case file by its UUID. |
| `chat_create` | Create a certified Telegram chat session. Must use the user's personal case file (oldest, owned by the user). |
| `chat_get` | Get a chat's details including `registeredAt` timestamp — required before creating a certificate. |
| `chat_invitation_url` | Get the Telegram invite link to share with chat participants. |
| `chat_certificate_create` | Generate a tamper-evident certificate for a Telegram chat conversation over a specified time range. |
| `chat_certificate_get` | Retrieve the status and details of a chat certificate. |
| `dossier_certify` | Certify a DRAFT dossier after linking evidences. Transitions DRAFT → CERTIFYING → CERTIFIED. |
| `dossier_group_certify` | Create and certify a dossier from a single evidence group in one call (express flow). |
| `dossier_evidence_link` | Link evidence items from a case file to a DRAFT dossier before certification. Only COMPLETED evidences from sealed groups. |
| `session_login` | Authenticate with GoCertius using email/password or OpenID Connect. |
| `session_info` | Look up the authentication type (Password or OpenID) configured for an email address. |

## Coexistence

This MCP server is the **current, actively maintained** interface for the GoCertius API.

It coexists safely with any other MCP servers in your setup — it exposes only GoCertius-namespaced tools and shares no local state with other servers.

## License

MIT — see [LICENSE](LICENSE).
