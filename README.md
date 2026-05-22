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

- `/evidence-lifecycle` — step-by-step workflow guide
- `/dossier-lifecycle` — step-by-step workflow guide
- `/notification-lifecycle` — step-by-step workflow guide
- `/chat-lifecycle` — step-by-step workflow guide

See [docs/agent-prompts.md](docs/agent-prompts.md) for end-to-end prompt examples and the tool sequences they trigger.

## Available Tools

This server exposes **28 tools**:

| Tool | Description |
|------|-------------|
| `evidence_create` | Performs the evidence_create operation against the GoCertius API. |
| `evidence_list` | Performs the evidence_list operation against the GoCertius API. |
| `evidence_seal` | Performs the evidence_seal operation against the GoCertius API. |
| `evidence_get` | Performs the evidence_get operation against the GoCertius API. |
| `evidence_group_create` | Performs the evidence_group_create operation against the GoCertius API. |
| `evidence_group_list` | Performs the evidence_group_list operation against the GoCertius API. |
| `dossier_create` | Performs the dossier_create operation against the GoCertius API. |
| `dossier_list` | Performs the dossier_list operation against the GoCertius API. |
| `dossier_get` | Performs the dossier_get operation against the GoCertius API. |
| `dossier_template_list` | Performs the dossier_template_list operation against the GoCertius API. |
| `notification_request_create` | Performs the notification_request_create operation against the GoCertius API. |
| `notification_request_send` | Performs the notification_request_send operation against the GoCertius API. |
| `notification_request_status` | Performs the notification_request_status operation against the GoCertius API. |
| `notification_receiver_add` | Performs the notification_receiver_add operation against the GoCertius API. |
| `notification_certificate_get` | Performs the notification_certificate_get operation against the GoCertius API. |
| `case_file_create` | Performs the case_file_create operation against the GoCertius API. |
| `case_file_list` | Performs the case_file_list operation against the GoCertius API. |
| `case_file_get` | Performs the case_file_get operation against the GoCertius API. |
| `chat_create` | Performs the chat_create operation against the GoCertius API. |
| `chat_get` | Performs the chat_get operation against the GoCertius API. |
| `chat_invitation_url` | Performs the chat_invitation_url operation against the GoCertius API. |
| `chat_certificate_create` | Performs the chat_certificate_create operation against the GoCertius API. |
| `chat_certificate_get` | Performs the chat_certificate_get operation against the GoCertius API. |
| `dossier_certify` | Performs the dossier_certify operation against the GoCertius API. |
| `dossier_group_certify` | Performs the dossier_group_certify operation against the GoCertius API. |
| `dossier_evidence_link` | Performs the dossier_evidence_link operation against the GoCertius API. |
| `session_login` | Performs the session_login operation against the GoCertius API. |
| `session_info` | Performs the session_info operation against the GoCertius API. |

## Coexistence

This MCP server is the **current, actively maintained** interface for the GoCertius API.

It coexists safely with any other MCP servers in your setup — it exposes only GoCertius-namespaced tools and shares no local state with other servers.

## License

MIT — see [LICENSE](LICENSE).
