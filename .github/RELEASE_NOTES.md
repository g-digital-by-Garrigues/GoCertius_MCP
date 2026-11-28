# GoCertius MCP v2.1.0

GoCertius gains e-signature. 99 tools, up from 62. Nothing that works in 2.0.0 stops
working: the one tool retired below has been refused by the platform to every
credential this server accepts since 2.0.0.

## New: e-signature

The same 28 signature tools as EAD Enterprise Suite: create a request, add documents,
signatories, observers and validators, place the signature boxes, activate, follow
progress, resend, close or cancel, and download the signed document, its certificate
and the certificate package. `signature_request_full` does create, upload, signatories,
placement and sending in one call, and the bundled `/signature-lifecycle` command walks
an agent through the whole flow.

Signatures need the signatures permit on your GoCertius account. Configurable signing
sequences and validator participants also depend on your company's plan; without them
the API answers 409.

## Also new

- **Evidence:** get an evidence group; update and delete evidences and evidence groups;
  a download URL for an evidence.
- **Case files:** `case_file_update`.
- **Chats:** `chat_list`, `chat_message_list`, `chat_participant_list`.
- **Dossiers:** optional `embeddedEvidences` on `dossier_create` and `dossier_update`.

## Retired

| Tool | Why |
|---|---|
| `case_file_delete` | The platform refuses it to user-key sessions, and a user key is the only credential this server can be configured with. It could not succeed on 2.0.0 either. |

No tool that stays lost an input field or gained a required one.

## Fixes you will notice

- **Idempotency:** two calls that differed only in a nested field — a
  `notification_send` to a different recipient within 24 h, page 2 of a list — were
  answered from the first call's cache. They no longer are.
- **Polling sees changes:** read-only tools no longer answer from a 60-second cache.
- **Readable errors:** the field issues of a 400/422 reach the agent instead of
  `[object Object]` or a bare "HTTP 422", including inside the one-call tools. A login
  refused because the account must accept new legal texts now says that only a person
  can do it, in the web app.
- **`notification_certificate_get`** now sends `embeddedDocuments` (it was silently
  dropped) and refuses an id reused with different options.
- **Descriptions:** every tool's description in the README and in the stores is now
  exactly what the server serves.

## Configuration

Nothing to change. The credential is the same as in 2.0.0 (`MCP_AUTH_USER_KEY` and
`MCP_API_BASE_URL`, both required). `.env.example` now also documents six optional
variables the server already read: `MCP_TRANSPORT`, `MCP_BRIDGE_STATE_FILE`,
`MCP_FILE_MAX_BYTES`, `MCP_FILE_ALLOWED_ROOTS`, `MCP_FILE_URL_ALLOWED_HOSTS` and
`MCP_OTEL_ENABLED`. The Docker image sets `MCP_TRANSPORT` itself — keep it out of any
env file you pass to the container.

## Upgrading the n8n connector

<!-- N8N_UPGRADE -->
### From 2.0.x

**Nothing to do for your credential.**

**94 operations, up from 58.** The new **Signature** resource brings e-signature to
GoCertius: create a request, add documents and participants, place the signature
boxes, activate it, follow the signatories' progress, and download the signed document
and its certificate. It needs the signatures permit on your account; configurable
signing sequences and validators also depend on your company's plan.

**One operation is gone: Case File → Delete Case File.** GoCertius refuses it to
User Key credentials, which is the only kind this connector has used since 2.0.0, so
it could not succeed. If a saved workflow still contains it, that node no longer has
a valid operation: remove it, or delete the case file in the GoCertius web app.

**Not in the connector, by design:** the one-call signature helper (it takes a file,
which this connector does not handle) and the two one-call notification helpers. Chain
the individual steps instead — every one of them is present.

### From 1.x

**If you already sign in with a User Key, there is nothing to do.** The credential type
has not changed — it keeps its name, and the **API Base URL** and **User Key** fields
keep theirs along with the values you already stored.

**If you sign in with an e-mail and password, that pair is gone.** Password sign-in now
requires 2FA / biometric verification, which cannot complete in an unattended workflow,
so no version of this connector can keep it working. Open the **GoCertius API**
credential, fill in **User Key**, and save. Editing the credential in place is enough:
you do not need to delete it, and you do not need to touch the nodes that use it.
Both fields are required:

| Field | Value |
|---|---|
| **API Base URL** (`MCP_API_BASE_URL`) | The GoCertius API root you connect to. |
| **User Key** (`MCP_AUTH_USER_KEY`) | Your long-lived user key. Replaces the e-mail/password pair. |
<!-- /N8N_UPGRADE -->
