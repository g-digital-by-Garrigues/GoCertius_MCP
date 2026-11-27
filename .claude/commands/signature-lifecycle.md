# Signature Lifecycle (GoCertius)

Manage the full digital signature workflow via GoCertius.

## One call: `signature_request_full` (start here)

```
signature_request_full(
  caseFileId: "<uuid>",
  requestId: "<new-uuid>",            # reuse it to retry: the request is never created twice
  name: "Contrato de servicios",
  language: "es_ES",
  deadline: "2026-12-20T23:59:59Z",   # at most 31 days ahead
  documents: [{ title: "Contrato", file: { source: "path", path: "/abs/contrato.pdf" } }],
  signatories: [{ firstName: "Ana", lastName: "García", email: "ana@empresa.com",
                  coordinates: [{ document: 0, page: 3, x: 100, y: 120 }] }],
  observers: [{ firstName: "Luis", lastName: "Pérez", email: "luis@empresa.com" }]
)
→ { requestId, status: "ACTIVE", documents: [...], signatoryIds: [...], observerIds: [...] }
```

It creates the request, uploads each document, adds the signatories one by one (so `sendWaUrl` /
`sendSmsUrl` work) and the observers, places every signature, waits for `READY_TO_SIGN` and sends it.
Every signatory signs every document.

- A PDF (or a `.docx` with `convertToPdf`) needs a position for every signatory: without one the call is
  refused **before anything is created**. Find the positions as described in
  [Placing signatures](#placing-signatures-coordinates), or pass `activate: false` to save a draft and
  tell the user the positions are still needed.
- If a step fails after the request exists, the error lists the ids created so far and the failing step:
  finish with the step-by-step tools below. Calling it again with the same `requestId` only reports the
  request.
- Use the step-by-step tools when you need ordered signing (`CONFIGURABLE` + groups), validators, or
  different signatories per document.

## Placing signatures (coordinates)

1. **Which documents need them:** every PDF, and every `.docx` sent with `convertToPdf` — for every
   signatory linked to it, **whatever the signature type**. Other files need none.
2. **Find the page:** read the PDF's text page by page and look for the signature block — the signer's
   name, "Firma", "Fdo.", "Signature", or the signature lines near the end. Pages count from 1.
3. **Position:** one `{page, x, y}` per signatory per document (more than one is allowed except for
   `WITH_CERTIFICATE` signatures). **Convention — measured live on 2026-11-26** (GoCertius production, simple and
   advanced signatures): x and y are PDF points (1/72 inch) from the page's **bottom-left** corner, and
   `(x, y)` is the **bottom-left corner of the signature stamp**. The stamp (signer's name, email and signing
   time over an emblem) occupies from x+15 to x+104 and from y to y+66.5. To sit it on a signature line that
   starts at (lx, ly): x = lx − 15, y = ly. Keep x between 45 (the signed PDF adds a 42-point band on every
   page's left edge) and page width − 104, and y at most page height − 67. Text extractors usually measure
   from the top: y = page height − y_top. A page the PDF does not have is **not refused**: the platform
   appends a blank page and signs there — check the page count first.
4. `signature_coordinate_set` takes the **participant id** (the `id` you gave the signatory) and replaces
   that signatory's positions on that document as a whole, so it is safe to call again.

## Step-by-step path

Use the individual tools when you need custom control over each step.

### Key concepts

- **Signature types**: `INTERPOSITION` (simple signature: the signer follows a link), `ADVANCED` (the signer confirms with a one-time code sent to their mobile, so `phonePrefix` + `phoneNumber` are required) or `WITH_CERTIFICATE` (the signer signs with their own digital certificate; one position per signatory and document). `signature_request_full` offers the first two.
- **Close condition**: `ALL_REQUIRED` (it completes when everyone has signed) or `PARTIAL_ALLOWED` (it completes once no signature is pending — a signatory who rejects does not block the others).
- **Sequence**: `PARALLEL` (all sign simultaneously) or `CONFIGURABLE` (ordered signing).
- **WhatsApp / SMS signing link** (`sendWaUrl` / `sendSmsUrl`): only for `INTERPOSITION` and `WITH_CERTIFICATE`
  signatories, and they need a phone (SMS only where the platform enables it). The platform **refuses** them (422) on `ADVANCED` and on observers/validators.
- **Advanced OTP**: `ADVANCED` signatures require `phonePrefix` and
  `phoneNumber`; the signer receives the OTP through that phone channel.
- **Document states**: DRAFT → processing → `READY_TO_SIGN`. Must be `READY_TO_SIGN` before activation.
- **Coordinates**: required at activation on every PDF (and every `.docx` with `convertToPdf`), for every signatory linked to it, whatever the signature type; other files need none. See [Placing signatures](#placing-signatures-coordinates).

### IDs you need before starting

- `caseFileId` — from `case_file_list` (use the `id` UUID, not the code like PR82)
- `userId` — returned by `session_info` (no parameters needed)

### Step 1 — Create the signature request

```
signature_request_create(
  caseFileId: "<uuid>",
  id: "<new-uuid>",
  name: "My Signature Request",
  language: "es_ES",
  deadline: "2026-06-30T23:59:59.000Z",
  signatureType: "INTERPOSITION",
  closeCondition: "ALL_REQUIRED",
  sequence: "PARALLEL"
)
```

Returns `{}` on success (the `id` you provided becomes the requestId).

### Step 2 — Register document

```
signature_request_add_document(
  caseFileId: "<uuid>",
  requestId: "<sig-request-uuid>",
  id: "<new-uuid>",
  title: "Document Title",
  fileName: "document.pdf",
  fileSize: <bytes>,
  hash: "<sha256-hex>"       # SHA-256 hex digest of the file
)
```

Returns `{ url: "<presigned-s3-url>" }`. The documentId is the `id` you passed in this call.

### Step 3 — Upload document to S3

```
PUT <presigned-url>
Content-Type: application/octet-stream
x-amz-checksum-sha256: <base64-encoded SHA-256>   # base64 of the same hash
Body: <raw file bytes>
```

### Step 4 — Add participants

```
signature_participant_create(
  caseFileId: "<uuid>",
  requestId: "<sig-request-uuid>",
  id: "<new-uuid>",
  role: "SIGNATORY",
  firstName: "Ana",
  lastName: "García",
  email: "ana@empresa.com",
  phonePrefix: "+34",         # must include the + sign
  phoneNumber: "600000000",
  linkToAllDocuments: true
)
```

#### The three roles, and the one id space

`role` is the only thing that distinguishes the three kinds of participant, and there is **one
create call** for all of them:

| `role` | What they do | Extra steps |
|---|---|---|
| `SIGNATORY` | must sign the document | needs coordinates on every PDF; `phonePrefix`+`phoneNumber` are mandatory for `ADVANCED` |
| `OBSERVER` | receives a read-only copy, never signs | none |
| `VALIDATOR` | must approve before *its* signatory can sign | do **not** pass `groupId` or `linkToAllDocuments`; link it afterwards with `assign_validator_to_signatory` |

**`participantId`, `signatoryId` and `validatorId` are the same id** — the UUID *you* generate and
pass as `id`. The create call returns **HTTP 201 with no body**, so nothing is handed back: keep the
id you minted. Which name it goes by depends only on the role you created it with.

There is one id space, but the **role-scoped endpoints only accept ids of the matching role**.
Passing a `VALIDATOR`'s id where a `signatoryId` is expected returns `404 "Signatory not found"`
(live-tested on INT, 2026-09-07). If you have lost track of who is who, call
`signature_participant_list(caseFileId, requestId)` — it returns every participant with its `role`,
contact details, and `valid`/`validationError`.

```
signature_participant_list(caseFileId, requestId)
#  → [{ id, role: "SIGNATORY" | "OBSERVER" | "VALIDATOR", firstName, lastName, email, valid, ... }]
```

Reading them back, by scope:

| I want... | Tool |
|---|---|
| every participant of the request, with roles | `signature_participant_list` |
| the signers of one document, with per-document status | `signature_document_signatory_list` |
| the observers of one document | `signature_document_observer_list` |
| the documents one signatory still has to sign | `signature_signatory_progress_list` |
| the validators linked to one signatory | `signature_validator_list` |

Fixing mistakes before activation: `signature_participant_update` (contact details — the role is
**not** updatable), `signature_participant_delete` (drop one person, and the way to change a role),
`signature_participant_invalid_purge` (drop everyone the platform marked `valid: false`),
`signature_validator_unassign` (remove a validator link without removing the person).

### Step 5 — Poll until READY_TO_SIGN

Call `signature_document_list(caseFileId, requestId)` and inspect each document's `status` (`signature_request_get` does not include the documents). Alternatively verify with the API directly. Typically 15–60 seconds for files under 4 MB.

**Do not activate before documents are processed — the API will return an error.**
Activation requires all of these to be true:

- at least one `SIGNATORY` exists,
- all documents have been uploaded to their presigned URLs,
- every uploaded document has finished backend processing and is `READY_TO_SIGN`,
- every PDF has signature coordinates for the required signatories.

> Note: neither participant list reports **document processing** status. Use
> `signature_document_list` to check whether documents reached `READY_TO_SIGN`.
> `signature_document_list(caseFileId, requestId)` lists the request's documents,
> and `signature_document_signatory_list(..., documentId)` reports each signatory's progress on one
> of them — that is per-*person* status, not per-*document* processing.

### Step 6 — Set signature coordinates (all types)

```
signature_coordinate_set(
  caseFileId: "<uuid>",
  requestId: "<sig-request-uuid>",
  documentId: "<doc-uuid>",        # the id you passed to signature_request_add_document
  signatoryId: "<participant-uuid>",
  coordinates: [{ page: 1, x: 30, y: 230 }]
)
```

`signatoryId` is the participant id. Required on PDFs (and converted `.docx`) for every signatory linked to them, whatever the type; the call replaces that signatory's positions on that document. Convention for x/y: see [Placing signatures](#placing-signatures-coordinates).

### Step 7 — Activate

```
activate_signature_request(caseFileId, requestId)
```

Transitions to `ACTIVE` and sends signing invitations to all participants.

### Step 8 — Monitor and retrieve certificate

- `signature_request_get(caseFileId, requestId)` — overall status
- `signature_document_list(caseFileId, requestId)` — the request's documents and their statuses
- `signature_document_signatory_list(caseFileId, requestId, documentId)` — each signatory's signing progress on one document
- `signature_certificate_get(caseFileId, requestId, documentId)` — final legal certificate for a specific document (only once the whole request is `COMPLETED` or `COMPLETED_MANUAL`)

---

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Skip `signature_coordinate_set` on a PDF | `activate_signature_request` fails with 409 `SignatoriesWithoutCoordinates`, whatever the type | Give every signatory a position on every PDF (and converted `.docx`); other files need none |
| Create a request again with the same `id` | 500, and an orphan request left on the platform | Check with `signature_request_get` first — `signature_request_full` does this for you |
| A document in `ERROR`, or one never uploaded | Activation fails with an opaque 504 | Check `signature_document_list`; a document that never got its bytes stays `PENDING` |
| Add a document whose `fileName` is already in the request | Refused | Give each document a different file name |
| Use the S3 resource UUID as `documentId` | Tool call fails (wrong ID) | Use the `id` you passed to `signature_request_add_document`, not the UUID in the S3 URL |
| Add participant with `ADVANCED` type but no phone | API rejects with `isDefined` on `phoneNumber`/`phonePrefix` | Always supply `phoneNumber` + `phonePrefix` for ADVANCED signatories |
| `activate_signature_request` before documents reach `READY_TO_SIGN` | API error | Poll `signature_document_list` until every document is `READY_TO_SIGN` |

## Cancel a request

Active requests can be cancelled before all signatories have signed:

```
signature_request_cancel(caseFileId, requestId)
```

## Status transitions

```
DRAFT → (activate) → ACTIVE → PARTIALLY_SIGNED → FULLY_SIGNED → COMPLETED
                         ↘ (signature_request_cancel) → CANCELLED
                         ↘ (rejected) → REJECTED
ACTIVE, PARTIALLY_SIGNED or REJECTED → (signature_request_close) → CLOSING → COMPLETED_MANUAL
```

Certificates, the signed PDF and the evidence package are available once the request is `COMPLETED`
or `COMPLETED_MANUAL`.

## After sending

| I want to… | Tool |
|---|---|
| see where it stands | `signature_request_get` (status), `signature_signatory_progress_list` (what each signatory still has to sign) |
| find my requests | `signature_request_list` |
| remind the signers who have not signed | `signature_request_resend` |
| finish it early with what has been signed (irreversible — confirm first) | `signature_request_close` |
| stop it altogether (irreversible) | `signature_request_cancel` |
| the signed PDF of a document | `signature_document_signed_url` (once `COMPLETED`/`COMPLETED_MANUAL`) |
| the certificate of a document | `signature_certificate_get` (same) |
| the whole evidence package | `signature_certificate_package_url` (same) |

## Example — full step-by-step sequence

```
1. session_info()                                     → userId
2. case_file_list(userId)                             → caseFileId
3. signature_request_create(...)                      → requestId (= id you provided)
4. signature_request_add_document(...)                → { url }  (documentId = id you provided)
5. PUT <url> with PDF bytes + checksum header
6. signature_participant_create(...)                  → participantId (= id you provided)
7. [poll] signature_document_list(...)                → wait until every document is READY_TO_SIGN
8. signature_coordinate_set(..., documentId, participantId)  ← all types
9. activate_signature_request(caseFileId, requestId)
10. [later] signature_certificate_get(caseFileId, requestId, documentId)  → legal certificate
```
