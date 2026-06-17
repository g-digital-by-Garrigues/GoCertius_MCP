# Gocertius — n8n connector

> MCP server for GoCertius, EAD Trust's Digital Trust platform. Provides certified evidence management, dossier creation, certified notifications, and certified chats via AI agents.

Install this connector and use Gocertius operations as steps inside any n8n workflow. Each operation maps to one capability of the underlying Gocertius platform.

## Install (self-hosted n8n)

```bash
npm install @g-digital/n8n-nodes-gocertius
```

Then restart n8n. The node will appear in the Nodes panel under "Gocertius".

## Using with n8n AI Agent

For AI-driven automation, configure an **n8n AI Agent node** with the following system prompt. It covers all lifecycle workflows: evidence creation, certified notifications, signature processes, dossier certification, and certified chats.

**→ Full system prompt and workflow guide:** [`@g-digital/n8n-agent-system-prompt`](https://www.npmjs.com/package/@g-digital/mcp-gocertius) — see the `docs/n8n-agent-workflows/gocertius-ead-system-prompt.md` in [MCP_Market_Distribution](https://github.com/g-digital-by-Garrigues/MCP_Market_Distribution/blob/main/docs/n8n-agent-workflows/gocertius-ead-system-prompt.md).

### Quick system prompt snippet

Paste this into your AI Agent node's **System Message**:

```
You are a Digital Trust assistant using the Gocertius n8n connector.
UUID generation: generate UUID v4 for all `id` fields you must supply.
IDs from responses: never invent path parameters — always use values returned by previous tool calls.
Async operations: after evidence_seal, dossier_certify, signature activation, and chat certification — poll the corresponding list/status tool until the terminal state is reached before proceeding.
File uploads: when a tool returns uploadFileUrl or url, PUT the file bytes there with a separate HTTP Request node before calling the next step.
See the full lifecycle guide at: https://github.com/g-digital-by-Garrigues/MCP_Market_Distribution/blob/main/docs/n8n-agent-workflows/gocertius-ead-system-prompt.md
```

## Operations

| Operation | Description |
|---|---|
| `evidence_create` | Registers a new evidence record inside an evidence group. Requires: evidence_group_create → evidenceGroupId, case_file_create → caseFileId. Generate a UUID v4 for `id`. Compute the SHA-256 hex hash of the file BEFORE calling. custodyType INTERNAL = GoCertius stores the file; EXTERNAL = only hash is registered. Optional: pass `fileUrl` (a publicly accessible URL) to have the tool download and upload the file to S3 automatically — no separate PUT needed. If fileUrl is omitted, the response includes uploadFileUrl for manual upload. WARNING: the API sometimes returns {code:'EvidenceCreateError'} even when the evidence was successfully persisted — always verify with evidence_list before retrying. |
| `evidence_list` | Lists all evidence records in a specific evidence group. Use to review uploaded documents before sealing the group, or to find a specific evidenceId. Requires: caseFileId and evidenceGroupId. Returns paginated list with IDs, titles, status, and timestamps. |
| `evidence_seal` | Seal and certify an evidence group. Closes the group to new additions and triggers async timestamping. Returns immediately — the group transitions OPEN → CLOSING → CLOSED. Poll evidence_group_list until status is CLOSED before linking to a dossier. |
| `evidence_get` | Retrieves a specific evidence record. Requires: evidence_create → evidenceId, evidence_group_create → evidenceGroupId, case_file_create → caseFileId. Returns status (COMPLETED|IN_PROCESS|ERROR), hash, and tspTimestamp when certified. |
| `evidence_group_create` | Creates an evidence group inside a case file. Requires: case_file_create → caseFileId. Generate a UUID v4 for `id`. Set evidenceType to FILE, PHOTO, VIDEO, or WEB_PLUGIN. Returns evidenceGroupId. One group can contain multiple evidence records. |
| `evidence_group_list` | Lists all evidence groups in a case file with their current status (OPEN, CLOSING, CLOSED). Use to find an existing group or check which groups are ready for sealing. Requires: caseFileId. |
| `dossier_create` | Creates a dossier to aggregate certified evidence groups into a single tamper-evident PDF. Requires: case_file_create → caseFileId. Evidence groups must be in CLOSED status before linking. Generate a UUID v4 string for `id`. Returns dossierId. After creation, link evidence with dossier_evidence_link, then certify with dossier_certify. |
| `dossier_update` | Updates the metadata of an existing dossier (name, template fields, expiry). Requires: dossier_create → dossierId, caseFileId. Only available while dossier is in DRAFT status. |
| `dossier_certify` | Certifies a DRAFT dossier, locking in all its associated evidence groups. The dossier must be in DRAFT status. After certification it transitions to CERTIFIED and a tamper-evident PDF is generated. Prerequisites: the dossier must exist (dossier_create) and have evidence groups linked. Use dossier_group_certify instead if you want to create + certify in one step from a single evidence group. Example: dossier_certify({ caseFileId: '...', dossierId: '...' }) |
| `dossier_list` | Lists all dossiers in a case file with their status and metadata. Use to find an existing dossierId or monitor certification progress. Requires: caseFileId. Returns paginated list with IDs, names, status, and creation dates. |
| `dossier_get` | Retrieves the full details of a specific dossier including status, linked evidence, and download URLs. Use to check current state or get certificate download URLs after CERTIFIED. Requires: caseFileId and dossierId. |
| `dossier_template_list` | Lists available dossier templates. No prerequisites. Returns template IDs and their translations per language. Use the returned id as dossierTemplateId in dossier_create. |
| `dossier_preview` | Returns an HTML preview URL of a dossier before certification. Requires: caseFileId and dossierId. |
| `dossier_document_url` | Returns the download URL for the certified dossier PDF. Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_package_url` | Returns the download URL for the full dossier package (PDF + evidence files). Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_visibility` | Updates the visibility (public/private) of a certified dossier. Requires: dossier_certify (CERTIFIED status), caseFileId, dossierId. |
| `dossier_delete` | Deletes a dossier. Available in DRAFT status (to discard before certification) or in CERTIFIED status (to permanently remove the certified dossier). Irreversible. Requires: caseFileId and dossierId. |
| `dossier_group_certify` | Creates AND certifies a dossier from a single sealed evidence group in one call (express path). Requires: evidence_seal (CLOSED status), case_file_create → caseFileId, evidence_group_create → evidenceGroupId. Generate a UUID v4 string for `id`. Use when you have exactly one sealed evidence group and don't need multi-group aggregation. Returns dossierId with CERTIFYING status → poll until CERTIFIED. |
| `dossier_evidence_link` | Links specific evidence items to a DRAFT dossier. Call once per case file containing evidences to link. After linking all evidences, call dossier_certify to finalize. For a single-group dossier, use dossier_group_certify instead (one step). Example: dossier_evidence_link({ caseFileId: '...', dossierId: '...', caseFileToLinkId: '...', ids: ['ev-uuid-1', 'ev-uuid-2'] }) |
| `dossier_evidence_list_to_link` | Lists evidence items that are available to be linked to a dossier (CLOSED groups not yet linked). Requires: caseFileId and dossierId. |
| `dossier_evidence_list` | Lists all evidence items linked to a dossier. Requires: caseFileId and dossierId. |
| `dossier_evidence_get` | Retrieves details of a specific evidence item linked to a dossier. Requires: caseFileId, dossierId, evidenceId. |
| `dossier_evidence_delete` | Removes an evidence item from a dossier. Only available while dossier is in DRAFT status. Requires: caseFileId, dossierId, evidenceId. |
| `notification_document_add` | Performs the notification_document_add operation. Review the API documentation for full field details. |
| `notification_request_create` | Creates a certified notification request. Requires: case_file_create → caseFileId. Generate a UUID v4 for `id`. Set language to en_GB or es_ES. Returns notificationRequestId. Add at least one receiver with notification_receiver_add before sending. IMPORTANT: The `content` field must be valid HTML — plain text without HTML tags will not render on the recipient landing page. Only the following HTML formats are supported: paragraphs (<p>), bold (<strong>), italic (<em>), unordered lists (<ul><li>), ordered lists (<ol><li>). Do not use other HTML tags or CSS. Avoid special typographic characters (em dashes, smart quotes) in `subject`; use standard ASCII equivalents (hyphen, straight quotes) instead. |
| `notification_request_send` | Trigger delivery of a certified notification to all added recipients. Returns immediately — delivery is async. Poll notification_request_status until status is DELIVERED before retrieving certificates. |
| `notification_request_status` | Checks the delivery status of a certified notification. Requires: notificationRequestId, caseFileId. Returns status (CREATING|DRAFT|IN_PROCESS|SENT|PARTIALLY_READ|FULLY_READ|PARTIALLY_ANSWERED|FULLY_ANSWERED). Poll until status is SENT or beyond. Do not call notification_certificate_get while status is CREATING, DRAFT, or IN_PROCESS. |
| `notification_receiver_add` | Adds a recipient to a notification request. Requires: notification_request_create → notificationRequestId, case_file_create → caseFileId. The `id` can be a UUID v4 or custom string (e.g. your internal user ID). Returns receiverId — save it for notification_certificate_get. Add all receivers before calling notification_request_send. |
| `notification_certificate_get` | Generates a PDF certificate for a specific receiver proving delivery and/or reading of the notification. Requires: notification_request_send (delivered), notification_receiver_add → receiverId, notification_request_create → notificationRequestId, case_file_create → caseFileId. Generate a UUID v4 for `id`. Returns pdfUrl when status reaches CERTIFIED. |
| `case_file_create` | Creates a new case file — the top-level container for all related operations (evidence, notifications, dossiers, chats). Call this first before any other operation. Generate a UUID v4 for `id`. For `useCaseId`, use the general GoCertius use case: `063a016a-1d62-4b7b-a24f-7cf4d1d289bf` unless a specific use case is required. Returns caseFileId needed for all subsequent calls. |
| `case_file_list` | Lists all case files in your GoCertius account. Pass userId (from session_login or session_info) to scope results to your account. Returns paginated list with IDs, names, and status. |
| `case_file_get` | Retrieves details of a specific case file. Requires: caseFileId. Use to verify a case file exists before creating evidence groups, dossiers, or notifications. |
| `chat_create` | Creates a certified chat channel (Telegram). IMPORTANT: Chats can only be created in the user's personal case file (created automatically when the GoCertius account was opened). Do not use a manually created case file — use session_info → case_file_list to find the personal case file (oldest createdAt, owned by the user). Generate a UUID v4 for `id`. Set service to Telegram. Returns chatId. Use chat_invitation_url to get the shareable Telegram link. |
| `chat_get` | Retrieves details of a certified chat. Requires: case_file_create → caseFileId, chat_create → chatId. Returns status, participants, and registeredAt timestamp. |
| `chat_invitation_url` | Returns the Telegram invitation URL for a certified chat. Requires: chat_create → chatId, case_file_create → caseFileId. Share the returned invitationUrl with participants so they can join the certified channel. |
| `chat_certificate_create` | Creates a certificate of a range of messages from a certified chat. Requires: chat_create → chatId, case_file_create → caseFileId, messages already present in the Telegram channel. Generate a UUID v4 for `id`. Specify chatMessagesFrom and chatMessagesTo as ISO timestamps (chatMessagesFrom must be AFTER the chat registeredAt timestamp). ASYNC: poll chat_certificate_get until status === CERTIFIED. |
| `chat_certificate_get` | Retrieves a certified chat certificate including its status, message range, and PDF download URL. Prerequisites: the certificate must have been created with chat_certificate_create. Returns documentUrl when status is CERTIFIED. Example: chat_certificate_get({ caseFileId: '...', chatId: '...', id: '...' }) |
| `session_login` | Authenticate with GoCertius. Reads MCP_AUTH_EMAIL to discover the auth type (Password or OpenId) for that account. For Password accounts: uses MCP_AUTH_PASSWORD to obtain a session JWT. For OpenId accounts: starts an Azure AD device flow — on the FIRST call returns a browser link and code for the user to approve with Microsoft Authenticator; call session_login AGAIN after approving to complete authentication. |
| `session_info` | Returns the authenticated user's session info including userId, session type (Password or OpenId), and for OpenId sessions: issuer, clientId, and scopes. Use this to retrieve the userId (UUID) required by case_file_list and other user-scoped operations. Prerequisites: a valid session (call session_login first if needed). Example: session_info() → { userId: '...uuid...', type: 'Password' } |

## Credentials

This node requires a "Gocertius API" credential with the following fields:

| Field | Description | Secret? |
|---|---|---|
| `API Base URL` | Base URL of the Gocertius REST API. Production default: `https://api-gocertius.gocertius.io` Leave blank only if you know your environment uses a different endpoint. | no |
| `MCP_ALLOW_INSECURE_FILE_URL` | Set to "true" to allow plain http:// fileUrl downloads in evidence_create (default https-only). Private/internal addresses are always rejected regardless. | no |
| `MCP_ALLOWED_HOSTS` | Comma-separated allowed Host headers. Empty = Host validation disabled (default). When set, requests with a Host outside the list are rejected. | no |
| `MCP_ALLOWED_ORIGINS` | Comma-separated allowed browser Origins (DNS-rebinding defense). Empty = reject any request carrying an Origin header; non-browser clients (CLI/SDK) send no Origin and are always allowed. Use '*' to allow all. | no |
| `MCP_AUTH_EMAIL` | Your GoCertius account email (Flow 1). Configure one of Flow 1 or Flow 2. | no |
| `MCP_AUTH_PASSWORD` | Your GoCertius account password (Flow 1, email/password accounts) (See https://www.gocertius.io for credential acquisition.) | yes |
| `MCP_HTTP_HOST` | Interface the HTTP transport binds to. Default 127.0.0.1 (localhost only). Set 0.0.0.0 to expose on all interfaces (containers do this automatically). | no |
| `MCP_HTTP_PUBLIC` | Set to "true" for public/multi-tenant deployments. Activates Host validation and refuses to start unless MCP_ALLOWED_ORIGINS or MCP_ALLOWED_HOSTS is set (fail-closed). | no |
> **Need credentials?** Sign up or log in at [https://www.gocertius.io](https://www.gocertius.io).

## Use as an AI Agent tool

This node is flagged `usableAsTool: true`, so any n8n AI Agent (n8n ≥ 1.79.0) can consume it dynamically: drag it into the workflow and wire its main output to an AI Agent's "Tool" input.

For best results pair with an AI Agent node running **V2** — V3 has a known empty-tool-response bug in some recent n8n versions (see [n8n issue #26202](https://github.com/n8n-io/n8n/issues/26202)).

## License

MIT. See [LICENSE](./LICENSE).
