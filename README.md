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
| **MCP Official Registry** | Auto-discovered as `io.github.g-digital-by-Garrigues/gocertius` — [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/v0/servers/io.github.g-digital-by-Garrigues/gocertius) |
| **n8n community node** | Install `@g-digital/n8n-nodes-gocertius` in n8n Settings → Community Nodes — [npmjs.com/package/@g-digital/n8n-nodes-gocertius](https://www.npmjs.com/package/@g-digital/n8n-nodes-gocertius) |
| **Smithery** | `smithery mcp install g-digital/gocertius` — [smithery.ai/servers/g-digital/gocertius](https://smithery.ai/servers/g-digital/gocertius) |

Every channel ships the same MCP server contract; the tools and environment configuration below apply regardless of which install path you choose.

> Need credentials? Visit: [https://www.gocertius.io](https://www.gocertius.io)

## Installation

### Claude Desktop

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### Claude Code (CLI)

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### Cursor

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### Windsurf

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### Cline

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### VS Code

```json
{
  "servers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### JetBrains

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

### Zed

```json
{
  "mcpServers": {
    "gocertius": {
      "args": [
        "-y",
        "@g-digital/mcp-gocertius"
      ],
      "command": "npx",
      "env": {
        "MCP_AUTH_EMAIL": "",
        "MCP_AUTH_PASSWORD": "<PASTE_MCP_AUTH_PASSWORD_HERE>",
        "MCP_OPENID_CLIENT_ID": "",
        "MCP_OPENID_ISSUER": "",
        "MCP_OPENID_REFRESH_TOKEN": "<PASTE_MCP_OPENID_REFRESH_TOKEN_HERE>",
        "PORT": ""
      }
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

## Environment Variables

| Name | Required | Secret | Description |
| --- | --- | --- | --- |
| `MCP_AUTH_EMAIL` | Yes | No | Your GoCertius account email address |
| `MCP_AUTH_PASSWORD` | Yes | Yes | Your GoCertius account password (See https://www.gocertius.io for credential acquisition.) |
| `MCP_OPENID_CLIENT_ID` | Yes | No | OpenID Connect client ID |
| `MCP_OPENID_ISSUER` | Yes | No | OpenID Connect issuer URL |
| `MCP_OPENID_REFRESH_TOKEN` | Yes | Yes | OpenID Connect refresh token (See https://www.gocertius.io for credential acquisition.) |
| `PORT` | Yes | No | HTTP port when running in hosted (HTTP) mode; ignored in stdio mode |
## Bundled Skills

This package ships Claude Code slash-commands under `.claude/commands/`. After install, invoke them from Claude Code:

- `/getting-started` — step-by-step workflow guide
- `/evidence-lifecycle` — step-by-step workflow guide
- `/dossier-lifecycle` — step-by-step workflow guide
- `/notification-lifecycle` — step-by-step workflow guide
- `/chat-lifecycle` — step-by-step workflow guide

See [docs/agent-prompts.md](docs/agent-prompts.md) for end-to-end prompt examples and the tool sequences they trigger.

## Available Tools

This server exposes **39 tools**:

| Tool | Description |
|------|-------------|
| `evidence_create` | Registers a new evidence record inside an evidence group. Requires: evidence_group_create → evidenceGroupId, case_file_create → caseFileId. Generate a UUID v4 for &#x60;id&#x60;. Compute the SHA-256 hex hash of the file BEFORE calling. Returns uploadFileUrl (presigned S3 URL) — PUT the file bytes to that URL before calling evidence_seal. custodyType INTERNAL &#x3D; GoCertius stores the file; EXTERNAL &#x3D; only hash is registered. |
| `evidence_list` | Lists all evidence records in a specific evidence group. Use to review uploaded documents before sealing the group, or to find a specific evidenceId. Requires: caseFileId and evidenceGroupId. Returns paginated list with IDs, titles, status, and timestamps. |
| `evidence_seal` | Seals an evidence group and triggers qualified TSP timestamping. Requires: evidence_create records uploaded to S3, case_file_create → caseFileId, evidence_group_create → evidenceGroupId. Set evidencesCount to the number of evidences in the group. ASYNC: after calling, poll evidence_group_list until the group status changes to CLOSED before linking to a dossier or generating certificates. |
| `evidence_get` | Retrieves a specific evidence record. Requires: evidence_create → evidenceId, evidence_group_create → evidenceGroupId, case_file_create → caseFileId. Returns status (COMPLETED|IN_PROCESS|ERROR), hash, and tspTimestamp when certified. |
| `evidence_group_create` | Creates an evidence group inside a case file. Requires: case_file_create → caseFileId. Generate a UUID v4 for &#x60;id&#x60;. Set evidenceType to FILE, PHOTO, VIDEO, or WEB_PLUGIN. Returns evidenceGroupId. One group can contain multiple evidence records. |
| `evidence_group_list` | Lists all evidence groups in a case file with their current status (OPEN, CLOSING, CLOSED). Use to find an existing group or check which groups are ready for sealing. Requires: caseFileId. |
| `dossier_create` | Creates a dossier to aggregate certified evidence groups into a single tamper-evident PDF. Requires: case_file_create → caseFileId. Evidence groups must be in CLOSED status before linking. Generate a UUID v4 string for &#x60;id&#x60;. Returns dossierId. After creation, link evidence with dossier_evidence_link, then certify with dossier_certify. |
| `dossier_update` | Updates the metadata of an existing dossier (name, template fields, expiry). Requires: dossier_create → dossierId, caseFileId. Only available while dossier is in DRAFT status. |
| `dossier_certify` | Certifies a dossier, generating a tamper-evident PDF and locking all linked evidence. Requires: dossier_create → dossierId, dossier_evidence_link (evidence linked), case_file_create → caseFileId. ASYNC: transitions DRAFT → CERTIFYING → CERTIFIED. Poll dossier_list until dossierId status &#x3D;&#x3D;&#x3D; CERTIFIED before downloading. |
| `dossier_list` | Lists all dossiers in a case file with their status and metadata. Use to find an existing dossierId or monitor certification progress. Requires: caseFileId. Returns paginated list with IDs, names, status, and creation dates. |
| `dossier_get` | Retrieves the full details of a specific dossier including status, linked evidence, and download URLs. Use to check current state or get certificate download URLs after CERTIFIED. Requires: caseFileId and dossierId. |
| `dossier_template_list` | Lists available dossier templates. No prerequisites. Returns template IDs and their translations per language. Use the returned id as dossierTemplateId in dossier_create. |
| `dossier_preview` | Returns an HTML preview URL of a dossier before certification. Requires: caseFileId and dossierId. |
| `dossier_document_url` | Returns the download URL for the certified dossier PDF. Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_package_url` | Returns the download URL for the full dossier package (PDF + evidence files). Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_visibility` | Updates the visibility (public/private) of a certified dossier. Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_delete` | Deletes a dossier. Available in DRAFT status (to discard before certification) or in CERTIFIED status (to permanently remove the certified dossier). Irreversible. Requires: caseFileId and dossierId. |
| `dossier_group_certify` | Creates AND certifies a dossier from a single sealed evidence group in one call (express path). Requires: evidence_seal (CLOSED status), case_file_create → caseFileId, evidence_group_create → evidenceGroupId. Generate a UUID v4 string for &#x60;id&#x60;. Use when you have exactly one sealed evidence group and don&#x27;t need multi-group aggregation. Returns dossierId with CERTIFYING status → poll until CERTIFIED. |
| `dossier_evidence_link` | Links evidence items from a sealed group to a dossier. Requires: dossier_create → dossierId, evidence_seal (CLOSED), case_file_create → caseFileId. Pass the ids array of evidence UUIDs. Can be called multiple times for evidence from different case files. |
| `dossier_evidence_list_to_link` | Lists evidence items that are available to be linked to a dossier (CLOSED groups not yet linked). Requires: caseFileId and dossierId. |
| `dossier_evidence_list` | Lists all evidence items linked to a dossier. Requires: caseFileId and dossierId. |
| `dossier_evidence_get` | Retrieves details of a specific evidence item linked to a dossier. Requires: caseFileId, dossierId, evidenceId. |
| `dossier_evidence_delete` | Removes an evidence item from a dossier. Only available while dossier is in DRAFT status. Requires: caseFileId, dossierId, evidenceId. |
| `notification_document_add` | Performs the notification_document_add operation against the GoCertius API. |
| `notification_request_create` | Creates a certified notification request. Requires: case_file_create → caseFileId. Generate a UUID v4 for &#x60;id&#x60;. Set language to en_GB or es_ES. Returns notificationRequestId. Add at least one receiver with notification_receiver_add before sending. IMPORTANT: The &#x60;content&#x60; field must be valid HTML — plain text without HTML tags will not render on the recipient landing page. Only the following HTML formats are supported: paragraphs (&lt;p&gt;), bold (&lt;strong&gt;), italic (&lt;em&gt;), unordered lists (&lt;ul&gt;&lt;li&gt;), ordered lists (&lt;ol&gt;&lt;li&gt;). Do not use other HTML tags or CSS. Avoid special typographic characters (em dashes, smart quotes) in &#x60;subject&#x60;; use standard ASCII equivalents (hyphen, straight quotes) instead. |
| `notification_request_send` | Sends the certified notification to all added receivers. Requires: notification_request_create → notificationRequestId, notification_receiver_add (at least one receiver), case_file_create → caseFileId. ASYNC: triggers delivery. Poll notification_request_status until status is SENT or beyond (PARTIALLY_READ, FULLY_READ) before generating certificates. |
| `notification_request_status` | Checks the delivery status of a certified notification. Requires: notificationRequestId, caseFileId. Returns status (CREATING|DRAFT|IN_PROCESS|SENT|PARTIALLY_READ|FULLY_READ|PARTIALLY_ANSWERED|FULLY_ANSWERED). Poll until status is SENT or beyond. Do not call notification_certificate_get while status is CREATING, DRAFT, or IN_PROCESS. |
| `notification_receiver_add` | Adds a recipient to a notification request. Requires: notification_request_create → notificationRequestId, case_file_create → caseFileId. The &#x60;id&#x60; can be a UUID v4 or custom string (e.g. your internal user ID). Returns receiverId — save it for notification_certificate_get. Add all receivers before calling notification_request_send. |
| `notification_certificate_get` | Generates a PDF certificate for a specific receiver proving delivery and/or reading of the notification. Requires: notification_request_send (delivered), notification_receiver_add → receiverId, notification_request_create → notificationRequestId, case_file_create → caseFileId. Generate a UUID v4 for &#x60;id&#x60;. Returns pdfUrl when status reaches CERTIFIED. |
| `case_file_create` | Creates a new case file — the top-level container for all related operations (evidence, notifications, dossiers, chats). Call this first before any other operation. Generate a UUID v4 for &#x60;id&#x60;. Returns caseFileId needed for all subsequent calls. |
| `case_file_list` | Lists all case files in your GoCertius account. Pass userId (from session_login or session_info) to scope results to your account. Returns paginated list with IDs, names, and status. |
| `case_file_get` | Retrieves details of a specific case file. Requires: caseFileId. Use to verify a case file exists before creating evidence groups, dossiers, or notifications. |
| `chat_create` | Creates a certified chat channel (Telegram). IMPORTANT: Chats can only be created in the user&#x27;s personal case file (created automatically when the GoCertius account was opened). Do not use a manually created case file — use session_info → case_file_list to find the personal case file (oldest createdAt, owned by the user). Generate a UUID v4 for &#x60;id&#x60;. Set service to Telegram. Returns chatId. Use chat_invitation_url to get the shareable Telegram link. |
| `chat_get` | Retrieves details of a certified chat. Requires: case_file_create → caseFileId, chat_create → chatId. Returns status, participants, and registeredAt timestamp. |
| `chat_invitation_url` | Returns the Telegram invitation URL for a certified chat. Requires: chat_create → chatId, case_file_create → caseFileId. Share the returned invitationUrl with participants so they can join the certified channel. |
| `chat_certificate_create` | Creates a certificate of a range of messages from a certified chat. Requires: chat_create → chatId, case_file_create → caseFileId, messages already present in the Telegram channel. Generate a UUID v4 for &#x60;id&#x60;. Specify chatMessagesFrom and chatMessagesTo as ISO timestamps (chatMessagesFrom must be AFTER the chat registeredAt timestamp). ASYNC: poll chat_certificate_get until status &#x3D;&#x3D;&#x3D; CERTIFIED. |
| `chat_certificate_get` | Retrieves the certificate of a certified chat. Requires: chat_certificate_create → certificate id, chat_create → chatId, case_file_create → caseFileId. Returns documentUrl when status reaches CERTIFIED. Poll until CERTIFIED before using documentUrl. |
| `session_login` | Authenticates with GoCertius using email and password (or Azure AD device flow) to obtain a session JWT. Call this only if you encounter 401 errors. The MCP server manages authentication automatically. Example: { email: &#x27;user@example.com&#x27;, password: &#x27;...&#x27; } |
| `session_info` | Retrieves information about the current authenticated session including userId, account, and token expiry. Use to verify who is authenticated or check session validity. No required parameters. |

## Coexistence

This MCP server is the **current, actively maintained** interface for the GoCertius API.

It coexists safely with any other MCP servers in your setup — it exposes only GoCertius-namespaced tools and shares no local state with other servers.

## License

MIT — see [LICENSE](LICENSE).
