# Gocertius — n8n connector

> Send and certify evidence, dossiers, notifications, and chats via the GoCertius platform.

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
| `evidence_create` | Registers a new evidence record inside an evidence group. |
| `evidence_list` | Lists all evidence records within a specific evidence group. |
| `evidence_seal` | Closes an evidence group and triggers certified timestamping. |
| `evidence_get` | Retrieves details and certification status of a specific evidence record. |
| `evidence_group_create` | Creates a new evidence group inside an existing case file. |
| `evidence_group_list` | Lists all evidence groups in a case file with their current status. |
| `dossier_create` | Creates a dossier to aggregate certified evidence groups into a PDF. |
| `dossier_update` | Updates metadata of a dossier that is still in draft status. |
| `dossier_certify` | Certifies a draft dossier, locking evidence and generating a tamper-evident PDF. |
| `dossier_list` | Lists all dossiers in a case file with their status and metadata. |
| `dossier_get` | Retrieves full details of a dossier, including status and download URLs. |
| `dossier_template_list` | Lists all available dossier templates with their IDs and translations. |
| `dossier_preview` | Returns an HTML preview URL for a dossier before certification. |
| `dossier_document_url` | Returns the download URL for a certified dossier PDF. |
| `dossier_package_url` | Returns the download URL for the full certified dossier package including evidence files. |
| `dossier_visibility` | Updates the public or private visibility of a certified dossier. |
| `dossier_delete` | Permanently deletes a dossier in draft or certified status. |
| `dossier_group_certify` | Creates and certifies a dossier from a single sealed evidence group in one step. |
| `dossier_evidence_link` | Links specific evidence items to a draft dossier before certification. |
| `dossier_evidence_list_to_link` | Lists evidence items available to be linked to a dossier. |
| `dossier_evidence_list` | Lists all evidence items currently linked to a dossier. |
| `dossier_evidence_get` | Retrieves details of a specific evidence item linked to a dossier. |
| `dossier_evidence_delete` | Removes an evidence item from a dossier while it is in draft status. |
| `notification_document_add` | Attaches a document to an existing certified notification request. |
| `notification_request_create` | Creates a certified notification request with HTML content for one or more recipients. |
| `notification_request_send` | Triggers delivery of a certified notification to all added recipients. |
| `notification_request_status` | Returns the current delivery status of a certified notification request. |
| `notification_receiver_add` | Adds a recipient to a certified notification request before sending. |
| `notification_certificate_get` | Generates a PDF delivery certificate for a specific notification recipient. |
| `case_file_create` | Creates a top-level case file container for all GoCertius operations. |
| `case_file_list` | Lists all case files in your GoCertius account with their status. |
| `case_file_get` | Retrieves details of a specific case file by its ID. |
| `chat_create` | Creates a certified Telegram chat channel linked to a personal case file. |
| `chat_get` | Retrieves status and participant details of a certified chat channel. |
| `chat_invitation_url` | Returns the Telegram invitation URL for participants to join a certified chat. |
| `chat_certificate_create` | Creates a certificate for a range of messages from a certified chat channel. |
| `chat_certificate_get` | Retrieves a chat certificate status and PDF download URL after certification. |
| `session_login` | Authenticates with GoCertius using password or OpenID and returns a session. |
| `session_info` | Returns the authenticated user's session details including userId and session type. |

## Credentials

This node requires a "Gocertius API" credential with the following fields:

| Field | Description | Secret? |
|---|---|---|
| `API Base URL` | Base URL of the Gocertius REST API. Production default: `https://api-gocertius.gocertius.io` Leave blank only if you know your environment uses a different endpoint. | no |
| `MCP_AUTH_EMAIL` | Enter the email address associated with your GoCertius account. | no |
| `MCP_AUTH_PASSWORD` | Enter the password for your GoCertius account, found at gocertius.io. | yes |
| `MCP_OPENID_CLIENT_ID` | Enter the OpenID Connect client ID provided by your identity provider. | no |
| `MCP_OPENID_ISSUER` | Enter the OpenID Connect issuer URL provided by your identity provider. | no |
| `MCP_OPENID_REFRESH_TOKEN` | Enter the OpenID Connect refresh token issued by your identity provider. | yes |
| `PORT` | Enter the port number to use when running the MCP server in HTTP mode. | no |
> **Need credentials?** Sign up or log in at [https://www.gocertius.io](https://www.gocertius.io).

## Use as an AI Agent tool

This node is flagged `usableAsTool: true`, so any n8n AI Agent (n8n ≥ 1.79.0) can consume it dynamically: drag it into the workflow and wire its main output to an AI Agent's "Tool" input.

For best results pair with an AI Agent node running **V2** — V3 has a known empty-tool-response bug in some recent n8n versions (see [n8n issue #26202](https://github.com/n8n-io/n8n/issues/26202)).

## License

MIT. See [LICENSE](./LICENSE).
