# GoCertius MCP v2.1.1

A fix for the n8n connector. **The MCP server is unchanged from 2.1.0**: nothing to do
for a server deployment — Docker image, npx or any MCP client.

## Fixed in the n8n connector

Fields that take JSON — the filter, order and page of every list operation, signature
coordinates, the evidence IDs linked to a dossier, and the bulk add of receivers or
participants — were sent to the API as plain text when you typed the value into the
field, and the API refused it. A value written as an expression (`{{ ... }}`) was not
affected. From 2.1.1 a typed value is read as JSON, and a value that is not valid JSON
stops the node with a message that names the field instead of reaching the API.

## Upgrading the n8n connector

<!-- N8N_UPGRADE -->
### From 2.1.0

**Nothing to do.** JSON fields you type into the node — list filter, order and page,
signature coordinates, the evidence IDs of a dossier, bulk receivers or participants —
now reach the API as JSON; in 2.1.0 a typed value was refused. Values written as
expressions keep working as before.

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
