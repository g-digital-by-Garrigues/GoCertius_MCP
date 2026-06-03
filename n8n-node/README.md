# Gocertius — n8n connector

> Manage certified evidence, dossiers, notifications, and chats on the GoCertius platform.

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
| `evidence_create` | Registers a new evidence record inside an evidence group, optionally uploading the file automatically. |
| `evidence_list` | Returns all evidence records within a specified evidence group, paginated. |
| `evidence_seal` | Closes an evidence group to new additions and triggers certified timestamping. |
| `evidence_get` | Retrieves a single evidence record with its certification status, hash, and timestamp. |
| `evidence_group_create` | Creates a new evidence group inside a case file to hold related evidence records. |
| `evidence_group_list` | Returns all evidence groups in a case file with their current status. |
| `dossier_create` | Creates a new dossier to aggregate certified evidence groups into a tamper-evident PDF. |
| `dossier_update` | Updates the metadata of a dossier that is still in DRAFT status. |
| `dossier_certify` | Locks a DRAFT dossier and generates a tamper-evident certified PDF from its evidence. |
| `dossier_list` | Returns all dossiers in a case file with their status and metadata, paginated. |
| `dossier_get` | Retrieves full details of a dossier including status, linked evidence, and download URLs. |
| `dossier_template_list` | Returns all available dossier templates with their IDs and language translations. |
| `dossier_preview` | Returns an HTML preview URL for a dossier before it is certified. |
| `dossier_document_url` | Returns the download URL for the certified dossier PDF. |
| `dossier_package_url` | Returns the download URL for the full certified dossier package including evidence files. |
| `dossier_visibility` | Updates the public or private visibility of a certified dossier. |
| `dossier_delete` | Permanently deletes a dossier in DRAFT or CERTIFIED status; this action is irreversible. |
| `dossier_group_certify` | Creates and certifies a dossier from a single sealed evidence group in one step. |
| `dossier_evidence_link` | Links specific evidence items from a case file to a DRAFT dossier. |
| `dossier_evidence_list_to_link` | Returns evidence items from closed groups that are available to link to a dossier. |
| `dossier_evidence_list` | Returns all evidence items currently linked to a specific dossier. |
| `dossier_evidence_get` | Retrieves details of a single evidence item linked to a dossier. |
| `dossier_evidence_delete` | Removes an evidence item from a DRAFT dossier. |
| `notification_document_add` | Attaches a document to a certified notification request. |
| `notification_request_create` | Creates a certified notification request with HTML content ready for recipient delivery. |
| `notification_request_send` | Triggers delivery of a certified notification to all added recipients asynchronously. |
| `notification_request_status` | Returns the current delivery status of a certified notification request. |
| `notification_receiver_add` | Adds a recipient to a notification request before it is sent. |
| `notification_certificate_get` | Generates a PDF certificate proving delivery and reading of a notification for one recipient. |
| `case_file_create` | Creates a top-level case file container required before any evidence, dossier, or notification operation. |
| `case_file_list` | Returns all case files in your GoCertius account, paginated. |
| `case_file_get` | Retrieves details of a specific case file to verify it exists before further operations. |
| `chat_create` | Creates a certified Telegram chat channel in your personal GoCertius case file. |
| `chat_get` | Retrieves status, participants, and registration details of a certified chat channel. |
| `chat_invitation_url` | Returns the Telegram invitation URL so participants can join a certified chat channel. |
| `chat_certificate_create` | Creates a certificate covering a date range of messages from a certified Telegram chat. |
| `chat_certificate_get` | Retrieves a chat certificate's status and PDF download URL after certification completes. |
| `session_login` | Authenticates with GoCertius using password or Azure AD OpenId device flow. |
| `session_info` | Returns the authenticated user's session details including userId and authentication type. |

## Credentials

This node requires a "Gocertius API" credential with the following fields:

| Field | Description | Secret? |
|---|---|---|
| `API Base URL` | Base URL of the Gocertius REST API. Production default: `https://api-gocertius.gocertius.io` Leave blank only if you know your environment uses a different endpoint. | no |
| `MCP_AUTH_EMAIL` | Enter the email address associated with your GoCertius account. | no |
| `MCP_AUTH_PASSWORD` | Enter the password for your GoCertius account, available at gocertius.io. | yes |
> **Need credentials?** Sign up or log in at [https://www.gocertius.io](https://www.gocertius.io).

## Use as an AI Agent tool

This node is flagged `usableAsTool: true`, so any n8n AI Agent (n8n ≥ 1.79.0) can consume it dynamically: drag it into the workflow and wire its main output to an AI Agent's "Tool" input.

For best results pair with an AI Agent node running **V2** — V3 has a known empty-tool-response bug in some recent n8n versions (see [n8n issue #26202](https://github.com/n8n-io/n8n/issues/26202)).

## License

MIT. See [LICENSE](./LICENSE).
