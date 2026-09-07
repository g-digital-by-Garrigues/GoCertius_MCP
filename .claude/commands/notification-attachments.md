# Certified Notifications — Attachments

Attach one or more documents to a certified notification. **Read this before attaching anything:**
the API imposes an ordering rule here that it does not impose anywhere else, and violating it fails
the send after the notification already exists.

## The rule

> Documents must be registered and uploaded **BEFORE any recipient is added**, and every document
> must reach `READY_TO_SEND` **before** the notification is sent.

Attaching after recipients, or sending while a document is still `PENDING`, fails with
`409` / `404 NOTIFICATION_NOT_FOUND`. This is tested behaviour, not a guess.

The consequence worth internalising: **once a recipient exists, you can no longer attach a document.**
If an upload fails, stop and fix it before adding anyone. A notification that already has recipients
can never receive the file you meant to send with it.

## The easy way

`notification_send_with_attachments` does the whole sequence in one call:

```
notification_send_with_attachments
  caseFileId=<cf-id>
  subject="Your contract"           language=en_GB     type=NO_RESPONSE
  content="<p>Please review the attached document.</p>"
  attachments=[ { file: { source: "path", path: "/abs/path/contract.pdf" } } ]
  recipients=[ { firstName: "Alice", lastName: "Smith", email: "alice@example.com" } ]
```

Each attachment's `file` accepts four sources:

| `source` | Fields | Use when |
|---|---|---|
| `path` | `path` | the file is on the server's own machine (stdio/local mode only) |
| `base64` | `filename`, `contentBase64` | you already hold the bytes |
| `url` | `url` | the file is at an HTTPS URL (fetched with SSRF protection) |
| `n8n-binary` | `binaryRef` | the file came from a previous node in an n8n workflow |

The hash, the presigned upload and the `READY_TO_SEND` wait are handled internally.

**If an attachment fails, the tool stops before adding recipients** and returns the draft's
`notificationRequestId`. That is deliberate — see the rule above. Retry the failed file with
`notification_document_add`, or discard the draft with `notification_request_delete`.

## The manual way

Only if you need control the composite does not give you. **The order is not negotiable.**

1. **Create the request** — `notification_request_create` (stays DRAFT)
2. **Attach every document, one at a time** — `notification_document_add` with a generated UUID `id`,
   `fileName`, and `hash` = the file's SHA-256 in **hex**, computed before the call.
   It returns `{ url }`, a presigned upload URL.
3. **Upload the bytes** — `PUT` the raw file to that `url` with an `x-amz-checksum-sha256` header
   carrying the same digest in **base64**. Hex in the header, or base64 in `hash`, is a silent
   rejection.
4. **Wait** — poll `notification_document_list` until every document is `READY_TO_SEND`.
   `PENDING → READY_TO_SEND` takes roughly 8 seconds. Poll every few seconds, a dozen times at most.
5. **Only now add recipients** — `notification_receiver_add`
6. **Send** — `notification_request_send`

## How many attachments

The maximum is a **per-subscription setting**, not a fixed API limit — it differs by tenant and by
platform. Do not assume a number. Attach what you need and read the error if the tenant's cap is
exceeded.

## Getting the attachments back

| Tool | Returns |
|---|---|
| `notification_document_list` | the attached documents and their status |
| `notification_document_download_url` | `{ downloadUrl }` — one attachment, as it was sent |
| `notification_certificate_document_url` | the delivery certificate PDF **alone** |
| `notification_certificate_package_url` | a ZIP with the certificate **and** the attachments |

There is **no "include preview" flag**. The distinction between a certificate with and without the
annexes is simply which of the last two you call.


## Verified in production (2026-09-04)

The ordering rule and the certificate forms were exercised end to end against the real API with a
real user key. These are responses, not expectations.

| | |
|---|---|
| `notification_send_with_attachments` | create → upload → wait → add recipient → send: **`sent: true`, no `409`** |
| Attachment status | `PENDING → READY_TO_SEND`, then `documentStats: { total: 1 }` |
| `notification_document_list` | reported the attachment at `READY_TO_SEND`, so this is the right thing to poll |
| `notification_certificate_document_url` | HTTP 200, `application/pdf`, 921 282 bytes |
| `notification_certificate_package_url` | HTTP 200, ZIP (magic `PK`), 886 321 bytes |

So the document/package distinction is real and the two genuinely differ — the ZIP is not the PDF
under another name.

One trap the run exposed: **`embeddedDocuments` does not mean "the package contains the
attachments"**. It came back `false` on a notification that had one, and `package-url` still
returned a ZIP carrying that attachment. Do not branch on it.

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Adding recipients before attaching | `409` / `404 NOTIFICATION_NOT_FOUND`, and the document can never be added | Attach first, always |
| Sending while a document is `PENDING` | Same failure | Poll `notification_document_list` until `READY_TO_SEND` |
| Hex digest in `x-amz-checksum-sha256` | S3 rejects the upload | Hex in `hash`, base64 in the header |
| Continuing after a failed upload | A notification that can never carry the file | Fix the upload before adding anyone |
| Looking for a "with annexes" flag | There isn't one | Call `notification_certificate_package_url` |
