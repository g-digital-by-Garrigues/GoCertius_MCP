# GoCertius MCP Server

[![npm version](https://img.shields.io/npm/v/@g-digital/mcp-gocertius)](https://www.npmjs.com/package/@g-digital/mcp-gocertius)
[![npm downloads](https://img.shields.io/npm/dm/@g-digital/mcp-gocertius)](https://www.npmjs.com/package/@g-digital/mcp-gocertius)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![provenance](https://img.shields.io/badge/npm-provenance-green)](https://www.npmjs.com/package/@g-digital/mcp-gocertius)
[![smithery badge](https://smithery.ai/badge/g-digital/gocertius)](https://smithery.ai/servers/g-digital/gocertius)

MCP server for GoCertius: certified evidence, dossiers, notifications and chats via AI agents.

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
      "command": "npx"
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
      "command": "npx"
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
      "command": "npx"
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
      "command": "npx"
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
      "command": "npx"
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
      "command": "npx"
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
      "command": "npx"
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
      "command": "npx"
    }
  }
}
```

> Need credentials? See: https://www.gocertius.io

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

| Name | Required | Secret | Description |
| --- | --- | --- | --- |
| `MCP_ALLOW_INSECURE_FILE_URL` | No | No | Set to "true" to allow plain http:// fileUrl downloads in evidence_create (default https-only). Private/internal addresses are rejected regardless (resolution-time check; see the documented DNS TOCTOU limitation in the hosted-deployment runbook). |
| `MCP_ALLOW_UNVERIFIED_BEARER` | No | No | Escape hatch for MCP_HTTP_PUBLIC=true WITHOUT inbound-token introspection: set to "true" ONLY when an upstream gateway already verifies Bearer tokens. The server logs a prominent warning and forwards tokens upstream unverified. |
| `MCP_ALLOWED_HOSTS` | No | No | Comma-separated allowed Host headers. Empty = Host validation disabled (default). When set, requests with a Host outside the list are rejected. |
| `MCP_ALLOWED_ORIGINS` | No | No | Comma-separated allowed browser Origins (DNS-rebinding defense). Empty = reject any request carrying an Origin header; non-browser clients (CLI/SDK) send no Origin and are always allowed. Use '*' to allow all. |
| `MCP_API_BASE_URL` | No | No | Overrides the default upstream API host for every tool |
| `MCP_AUTH_EMAIL` | No | No | Your GoCertius account email. Configure exactly one flow; do not combine it with the others. |
| `MCP_AUTH_PASSWORD` | No | Yes | Your GoCertius account password. (See https://www.gocertius.io for credential acquisition.) |
| `MCP_AUTH_USER_KEY` | No | Yes | Long-lived GoCertius user key, exchanged automatically for a short-lived session token. Use it for headless or automated access instead of an account password. Configure exactly one flow; do not combine it with the others. (See https://www.gocertius.io for credential acquisition.) |
| `MCP_HTTP_HOST` | No | No | Interface the HTTP transport binds to. Default 127.0.0.1 (localhost only). Set 0.0.0.0 to expose on all interfaces (containers do this automatically). |
| `MCP_HTTP_MAX_BODY_BYTES` | No | No | Maximum accepted POST /mcp request-body size in bytes (default 16777216 = 16 MiB — sized so base64 file uploads within the documented tool limits fit). Oversized requests get a 413 JSON-RPC error before/while reading — closes a memory-exhaustion DoS vector in public deployments. Note: base64 file sources are capped by this limit BEFORE MCP_FILE_MAX_BYTES applies. |
| `MCP_HTTP_PUBLIC` | No | No | Set to "true" for public/multi-tenant deployments. Activates Host validation and refuses to start unless (1) MCP_ALLOWED_ORIGINS or MCP_ALLOWED_HOSTS is set AND (2) inbound Bearer introspection is configured (MCP_SVC_INTROSPECT_URL + MCP_SVC_CLIENT_ID/SECRET) or MCP_ALLOW_UNVERIFIED_BEARER=true is set explicitly (fail-closed). |
| `MCP_SVC_CLIENT_ID` | No | No | Client ID this server presents to the introspection endpoint above (its resource-server credentials). Only needed alongside MCP_SVC_INTROSPECT_URL; it does not authenticate you to GoCertius. |
| `MCP_SVC_CLIENT_SECRET` | No | Yes | Client secret this server presents to the introspection endpoint above (its resource-server credentials). Only needed alongside MCP_SVC_INTROSPECT_URL; it does not authenticate you to GoCertius. (See https://www.gocertius.io for credential acquisition.) |
| `MCP_SVC_INTROSPECT_URL` | No | No | RFC 7662 token introspection URL for inbound Bearer verification in HTTP mode. Opt-in, and required when MCP_HTTP_PUBLIC=true. Leave empty for stdio (local) use. |
| `PORT` | No | No | HTTP port when running in hosted (HTTP) mode; ignored in stdio mode |

| Variable | Required | Description |
|---|---|---|
| `MCP_AUTH_EMAIL` | One of the two flows | Your account email |
| `MCP_AUTH_PASSWORD` | One of the two flows | Your account password |
| `MCP_AUTH_USER_KEY` | One of the two flows | Long-lived user key (exchanged for a session token) |
| `MCP_AUTH_JWT` | Optional | Pre-seeded JWT (skips interactive login) |
| `MCP_OTEL_ENABLED` | Optional | Set to `true` to enable OpenTelemetry tracing |
| `MCP_API_BASE_URL` | Optional | Override upstream API base URL |

## Bundled Skills

This package ships Claude Code slash-commands under `.claude/commands/`. After install, invoke them from Claude Code:

- `/getting-started` — step-by-step workflow guide
- `/evidence-lifecycle` — step-by-step workflow guide
- `/dossier-lifecycle` — step-by-step workflow guide
- `/notification-lifecycle` — step-by-step workflow guide
- `/chat-lifecycle` — step-by-step workflow guide

See [docs/agent-prompts.md](docs/agent-prompts.md) for end-to-end prompt examples and the tool sequences they trigger.

## Available Tools

This server exposes **41 tools**:

| Tool | Description |
|------|-------------|
| `evidence_create` | Registers a NEW evidence record inside an evidence group. Requires: evidence_group_create → evidenceGroupId, case_file_create → caseFileId. Generate a UUID v4 for `id` and compute the SHA-256 hex hash BEFORE calling. INTERNAL flow: call with custodyType INTERNAL; the response returns uploadFileUrl (presigned S3 URL). PUT the exact file bytes to uploadFileUrl, then verify with evidence_get/evidence_list, and ONLY THEN call evidence_seal. Do not seal while any INTERNAL evidence file is not uploaded. EXTERNAL flow: use custodyType EXTERNAL only for intentional hash-only evidence; each evidence still needs a fresh UUID. If a previous evidence create/upload failed and outcome is unknown, verify with evidence_list before retrying and do not reuse the same id unless you confirmed it was not persisted. WARNING: the API sometimes returns {code:'EvidenceCreateError'} even when the evidence was successfully persisted. |
| `evidence_list` | Lists all evidence records in a specific evidence group. Use to review uploaded documents before sealing the group, or to find a specific evidenceId. Requires: caseFileId and evidenceGroupId. Returns paginated list with IDs, titles, status, and timestamps. |
| `evidence_seal` | Seals an evidence group and triggers qualified TSP timestamping. Requires: all INTERNAL evidence records in the group have already been uploaded to their uploadFileUrl and verified with evidence_get/evidence_list. Requires case_file_create → caseFileId and evidence_group_create → evidenceGroupId. Set evidencesCount to the number of evidences in the group. ASYNC: after calling, poll evidence_group_list until the group status changes to CLOSED before linking to a dossier or generating certificates. |
| `evidence_get` | Retrieves a specific evidence record. Requires: evidence_create → evidenceId, evidence_group_create → evidenceGroupId, case_file_create → caseFileId. Returns status (COMPLETED|IN_PROCESS|ERROR), hash, and tspTimestamp when certified. |
| `evidence_group_create` | Creates an evidence group inside a case file. Requires: case_file_create → caseFileId. Generate a UUID v4 for `id`. Set evidenceType to FILE, PHOTO, VIDEO, or WEB_PLUGIN. Returns evidenceGroupId. One group can contain multiple evidence records. |
| `evidence_group_list` | Lists all evidence groups in a case file with their current status (OPEN, CLOSING, CLOSED). Use to find an existing group or check which groups are ready for sealing. Requires: caseFileId. |
| `dossier_create` | Creates a dossier to aggregate certified evidence groups into a single tamper-evident PDF. Requires: case_file_create → caseFileId. Evidence groups must be in CLOSED status before linking. Generate a UUID v4 string for `id`. Returns dossierId. After creation, link evidence with dossier_evidence_link, then certify with dossier_certify. |
| `dossier_update` | Updates the metadata of an existing dossier (name, template fields, expiry). Requires: dossier_create → dossierId, caseFileId. Only available while dossier is in DRAFT status. |
| `dossier_certify` | Certifies a dossier, generating a tamper-evident PDF and locking all linked evidence. Requires: dossier_create → dossierId, dossier_evidence_link (evidence linked), case_file_create → caseFileId. ASYNC: transitions DRAFT → CERTIFYING → CERTIFIED. Poll dossier_list until dossierId status === CERTIFIED before downloading. |
| `dossier_list` | Lists all dossiers in a case file with their status and metadata. Use to find an existing dossierId or monitor certification progress. Requires: caseFileId. Returns paginated list with IDs, names, status, and creation dates. |
| `dossier_get` | Retrieves the full details of a specific dossier including status, linked evidence, and download URLs. Use to check current state or get certificate download URLs after CERTIFIED. Requires: caseFileId and dossierId. |
| `dossier_template_list` | Lists available dossier templates. No prerequisites. Returns template IDs and their translations per language. Use the returned id as dossierTemplateId in dossier_create. |
| `dossier_preview` | Returns an HTML preview URL of a dossier before certification. Requires: caseFileId and dossierId. |
| `dossier_document_url` | Returns the download URL for the certified dossier PDF. Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_package_url` | Returns the download URL for the full dossier package (PDF + evidence files). Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_visibility` | Updates the visibility (public/private) of a certified dossier. Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_delete` | Deletes a dossier. Available in DRAFT status (to discard before certification) or in CERTIFIED status (to permanently remove the certified dossier). Irreversible. Requires: caseFileId and dossierId. |
| `dossier_group_certify` | Creates AND certifies a dossier from a single sealed evidence group in one call (express path). Requires: evidence_seal (CLOSED status), case_file_create → caseFileId, evidence_group_create → evidenceGroupId. Generate a UUID v4 string for `id`. Use when you have exactly one sealed evidence group and don't need multi-group aggregation. Returns dossierId immediately with CERTIFYING status → poll until CERTIFIED. |
| `dossier_evidence_link` | Links evidence records from a sealed evidence group to a dossier. Requires: dossier_create → dossierId, evidence_seal (CLOSED status), case_file_create → caseFileId. Evidence groups MUST be in CLOSED status. Pass the ids array of evidence UUIDs to link. Can be called multiple times for evidence from different case files. |
| `dossier_evidence_list_to_link` | Lists evidence items that are available to be linked to a dossier (CLOSED groups not yet linked). Requires: caseFileId and dossierId. |
| `dossier_evidence_list` | Lists all evidence items linked to a dossier. Requires: caseFileId and dossierId. |
| `dossier_evidence_get` | Retrieves details of a specific evidence item linked to a dossier. Requires: caseFileId, dossierId, evidenceId. |
| `dossier_evidence_delete` | Removes an evidence item from a dossier. Only available while dossier is in DRAFT status. Requires: caseFileId, dossierId, evidenceId. |
| `notification_document_add` | Performs the notification_document_add operation. Review the API documentation for full field details. |
| `notification_request_create` | Creates a certified notification request. Requires: case_file_create → caseFileId. Generate a UUID v4 for `id`. Set language to en_GB or es_ES. Returns notificationRequestId. Add at least one receiver with notification_receiver_add before sending. IMPORTANT: The `content` field must be valid HTML — plain text without HTML tags will not render on the recipient landing page. Only the following HTML formats are supported: paragraphs (<p>), bold (<strong>), italic (<em>), unordered lists (<ul><li>), ordered lists (<ol><li>). Do not use other HTML tags or CSS. Avoid special typographic characters (em dashes, smart quotes) in `subject`; use standard ASCII equivalents (hyphen, straight quotes) instead. |
| `notification_request_send` | Sends the certified notification to all added receivers. Requires: notification_request_create → notificationRequestId, notification_receiver_add (at least one receiver), case_file_create → caseFileId. ASYNC: triggers delivery. Poll notification_request_status until status is SENT or beyond (PARTIALLY_READ, FULLY_READ) before generating certificates. |
| `notification_request_status` | Checks the delivery status of a certified notification. Requires: notificationRequestId, caseFileId. Returns status (CREATING|DRAFT|IN_PROCESS|SENT|PARTIALLY_READ|FULLY_READ|PARTIALLY_ANSWERED|FULLY_ANSWERED). Poll until status is SENT or beyond. Do not call notification_certificate_get while status is CREATING, DRAFT, or IN_PROCESS. |
| `notification_receiver_add` | Adds a recipient to a notification request. Requires: notification_request_create → notificationRequestId, case_file_create → caseFileId. The `id` can be a UUID v4 or custom string (e.g. your internal user ID). Returns receiverId — save it for notification_certificate_get. Add all receivers before calling notification_request_send. |
| `notification_certificate_get` | Generates or retrieves a PDF certificate for a specific receiver proving delivery and/or reading of the notification. Requires: notification_request_send, notification_receiver_add → receiverId, notification_request_create → notificationRequestId, case_file_create → caseFileId. Generate a UUID v4 for `id` the first time you request a certificate for that receiver and reuse that same id when polling. Call only after notification_request_status is SENT or beyond. The first call may return {} while the certificate is being generated; poll/re-call notification_certificate_get until the response includes a pdfUrl/documentUrl or a CERTIFIED/final status. If the backend returns Forbidden/Unexpected at SENT, do not keep hammering the certificate endpoint: poll notification_request_status until READ/ANSWERED or verify in the UI, then retry with the same certificate id. For ACCEPTED_OR_NOT notifications, call once after a certifiable delivery/read state for an intermediate certificate and again after PARTIALLY_ANSWERED/FULLY_ANSWERED for the final answer certificate. |
| `case_file_create` | Creates a new case file — the top-level container for all related operations (evidence, notifications, dossiers, chats). Call this first before any other operation. Generate a UUID v4 for `id`. Returns caseFileId needed for all subsequent calls. |
| `case_file_list` | Lists all case files in your GoCertius account. Pass userId (from session_login or session_info) to scope results to your account. Returns paginated list with IDs, names, and status. |
| `case_file_get` | Retrieves details of a specific case file. Requires: caseFileId. Use to verify a case file exists before creating evidence groups, dossiers, or notifications. |
| `chat_create` | Creates a certified chat channel (Telegram). IMPORTANT: Chats can only be created in the user's personal case file (created automatically when the GoCertius account was opened). Do not use a manually created case file — use session_info → case_file_list to find the personal case file (oldest createdAt, owned by the user). Generate a UUID v4 for `id`. Set service to Telegram. Returns immediately and the chat may start in status `creating`; call chat_get and wait until it is registered/active before requesting the invitation URL or certificates. |
| `chat_get` | Retrieves details of a certified chat. Requires: personal caseFileId and chat_create → chatId. Returns status, participants, and registeredAt timestamp. After chat_create, poll chat_get until status is active/registered and registeredAt is present; createdAt is not enough for certificate creation. |
| `chat_invitation_url` | Returns the Telegram invitation URL for a certified chat. Requires: chat_create → chatId and the personal caseFileId. Do not call while chat_get still shows status `creating`; wait until the chat is registered/active, otherwise the API can answer Chat not found. Share the returned invitationUrl with participants so they can join the certified channel. |
| `chat_certificate_create` | Creates a certificate of a range of messages from a certified chat. Requires: chat_create → chatId, personal caseFileId, chat_get → registeredAt, and messages already present in the Telegram channel. Generate a UUID v4 for `id`. Do not use createdAt as a substitute for registeredAt; if registeredAt is missing, the chat is not ready to certify. Specify chatMessagesFrom and chatMessagesTo as ISO timestamps (chatMessagesFrom must be AFTER registeredAt). ASYNC: poll chat_certificate_get until status === CERTIFIED. |
| `chat_certificate_get` | Retrieves the certificate of a certified chat. Requires: chat_certificate_create → certificate id, chat_create → chatId, case_file_create → caseFileId. Returns documentUrl when status reaches CERTIFIED. Poll until CERTIFIED before using documentUrl. |
| `session_login` | Authenticates with GoCertius to obtain a session JWT. Takes NO parameters — credentials are read from the server environment: MCP_AUTH_USER_KEY (a long-lived user key, exchanged automatically for a session token) or MCP_AUTH_EMAIL plus MCP_AUTH_PASSWORD. The MCP server manages authentication automatically; call this only if you hit 401 errors. |
| `session_info` | Retrieves information about the current authenticated session including userId, account, and token expiry. Use to verify who is authenticated or check session validity. Works on both auth flows: on a user-key deployment (MCP_AUTH_USER_KEY, no email configured) it resolves identity via GET /profile; with MCP_AUTH_EMAIL it queries /session-info. If you only need the userId, prefer profile_get — it is the canonical source (`id`) and also returns companyId and defaultCaseFileId. No required parameters. |
| `profile_get` | Returns the authenticated user's own profile. Works on EVERY auth flow (user key or email/password) because it identifies the caller from the session token alone — no email needed. Its `id` field IS your userId (UUID): the value required by case_file_list and every /users/{userId}/... operation. Prefer this over session_info when you need the userId, and it is the ONLY way to obtain it on a user-key deployment (MCP_AUTH_USER_KEY), where no email is configured. Also returns companyId (needed to subscribe to the notifications SSE stream) and defaultCaseFileId (the personal case file — the one chats must use). No parameters. |
| `evidence_upload` | Uploads a local file as evidence in one step: computes its SHA-256, registers the evidence record (custodyType INTERNAL = GoCertius stores the file), and uploads the bytes to S3 — no manual hashing or PUT needed. Internally this follows the required GoCertius sequence: create INTERNAL evidence → receive uploadFileUrl (presigned S3 URL) → PUT file bytes → return uploaded:true. Requires: case_file_create → caseFileId, evidence_group_create → evidenceGroupId. Provide EXACTLY ONE of `filePath` (absolute local path, stdio/local mode only) or `contentBase64` (base64-encoded file content, ~10 MB max). Use evidence_upload when the file is on the local machine; use evidence_create when you already have the SHA-256 hash, need to inspect/use uploadFileUrl manually, or have a public fileUrl. After this tool succeeds, verify with evidence_get/evidence_list and only then call evidence_seal. If this tool fails before returning an evidence id, check evidence_list before retrying; if retrying manually, use evidence_create with a fresh UUID. Local files must be under 1 GiB. |

## Coexistence

This MCP server is the **current, actively maintained** interface for the GoCertius API.

It coexists safely with any other MCP servers in your setup — it exposes only GoCertius-namespaced tools and shares no local state with other servers.

## License

MIT — see [LICENSE](LICENSE).
