# Certified Notification Lifecycle

Send a certified electronic notification to one or more recipients and obtain a legal certificate for each one.

## Notification types

| Type | API value | What recipients can do |
|---|---|---|
| Information only | `NO_RESPONSE` | Read only — no reply expected |
| Accept / Reject | `ACCEPTED_OR_NOT` | Click Accept or Reject |
| Received / Received + Not Compliant | `RECEIVED_AGREE` | Acknowledge receipt and agree or disagree |

## Status progression

`CREATING` → `DRAFT` → `IN_PROCESS` → `SENT` → `PARTIALLY_READ` / `FULLY_READ` → `PARTIALLY_ANSWERED` / `FULLY_ANSWERED`

The notification stays in `DRAFT` until explicitly sent via `notification_request_send`.

## The easy way

`notification_send` does the whole thing in one call — create, add every recipient, send:

```
notification_send
  caseFileId=<cf-id>
  subject="Your contract is ready"   language=en_GB   type=NO_RESPONSE
  content="<p>Please review the information below.</p>"
  recipients=[ { firstName: "Alice", lastName: "Smith", email: "alice@example.com" } ]
```

It generates every UUID itself. If something fails partway it does **not** throw away what it built:
the result carries `notificationRequestId` together with `recipientsAdded`, `recipientsFailed` and
`sent`, so you can finish with the granular tools below.

**Attaching files is a different tool** — `notification_send_with_attachments` — because attachments
must go on before recipients. See the `notification-attachments` skill.

## The manual flow

1. **Create the notification request** (stays DRAFT)
   - `notification_request_create` with a generated UUID `id`, `caseFileId`, `type`, `subject`, `content`, `language`
   - **IMPORTANT — `content` must be valid HTML.** Plain text without HTML tags will not render on the recipient landing page. Supported tags only: `<p>`, `<strong>`, `<em>`, `<ul><li>`, `<ol><li>`. No other HTML tags or CSS. Avoid special typographic characters (em dashes, smart quotes) in `subject`; use standard ASCII equivalents instead.
   - Optional defaults for every recipient: `otpByDefault`, `sendWaUrlByDefault`, `sendSmsUrlByDefault`

2. **Add recipients** (one call each)
   - `notification_receiver_add` with a generated UUID `id`, `notificationRequestId`, `caseFileId`, `firstName`, `lastName`, `email`
   - Or `notification_receiver_add_bulk` for several at once — but note the bulk form does **not** accept the per-recipient `otpRequired` / `sendWaUrl` / `sendSmsUrl` flags; set the defaults on the request instead.
   - **How many recipients?** The maximum is a **per-subscription setting** that differs by tenant and by platform. There is no fixed API limit — add what you need and read the error if the tenant's cap is exceeded.
   - Channels: email always, plus `sendWaUrl` (WhatsApp) and `sendSmsUrl` (RCS where the handset supports it, SMS otherwise). `otpRequired` challenges the recipient with a one-time code. Each of those three needs `phonePrefix` (with the `+`) and `phoneNumber`.

3. **Check the recipients took** — REQUIRED, not optional. An `INVALID` recipient **blocks the send**
   - `notification_receiver_list` — an address the platform rejected appears with status `INVALID` and a `validationError` (`TAKEN`, `IS_DEFINED`, `IS_INVALID`)
   - `notification_receiver_invalid_purge` removes every `INVALID` recipient in one call
   - `notification_receiver_update` fixes a mistyped address without losing the `receiverId`

4. **Send the notification**
   - `notification_request_send` with `caseFileId` and `notificationRequestId`
   - Returns immediately — delivery is async; status transitions to `SENT`

5. **Monitor delivery**
   - `notification_request_status` with `caseFileId` and `notificationRequestId`
   - Check `status` and `receiverStats` (total / bounced / valid)

   **Completion detection:**

   | Runtime | Approach |
   |---|---|
   | Claude Code / n8n (standard `callTool`) | Poll `notification_request_status` until `status: SENT` or beyond (`PARTIALLY_READ`, `FULLY_READ`, `PARTIALLY_ANSWERED`, `FULLY_ANSWERED`) |
   | Task-capable MCP client (experimental task streaming) | Server pushes completion via SSE when notification is sent — no polling needed |

6. **Generate per-receiver certificates** (once the notification is certifiable)
   - `notification_certificate_get` with a generated UUID `id`, `caseFileId`, `notificationRequestId`, `receiverId`, `language`
   - For simple delivery evidence, start after `SENT` only if the platform already exposes evidence/certificate data. For notification types that expect recipient action, prefer `PARTIALLY_READ`/`FULLY_READ` or `PARTIALLY_ANSWERED`/`FULLY_ANSWERED`.
   - Re-call after `FULLY_ANSWERED` for the final answer certificate.
   - The first call can return `{}` while generation is queued. Reuse the same
     certificate `id` and poll/re-call until the response includes a PDF URL or
     final certificate status.
   - If the endpoint returns `Forbidden` or `{ "code": "Unexpected", "id": ... }`,
     stop polling `notification_certificate_get`; poll `notification_request_status`
     until the notification progresses or verify the evidence in the UI, then
     retry with the same certificate id.


7. **Download the certificate**
   - `notification_certificate_list` shows what already exists for a recipient — reuse it rather than generating a duplicate. Each entry carries `status` (`DRAFT`, `CERTIFYING`, `CERTIFIED`), `partial` (an intermediate certificate, issued before the recipient finished responding) and `embeddedDocuments`.
   - `notification_certificate_document_url` → `{ documentUrl }`, the certificate PDF **alone**
   - `notification_certificate_package_url` → `{ packageUrl }`, a ZIP with the certificate **and** the notification's attachments
   - There is **no "include annexes" flag**. The difference is simply which of the two you call. Generation is async — the first call can 404 while the certificate is still `CERTIFYING`, so poll a few times rather than hammering it.

## If you lose track of a notification

`notification_request_list` is the only way back to a `notificationRequestId` you no longer have. It
takes a `userId` (from `session_info` or `profile_get`) and spans every case file. Filter by `status`,
`caseFileIds`, `search` over the subject, or `receiversSearch` to find the notification sent to a
given recipient.

While a notification is still a draft you can also edit it (`notification_request_update`),
delete it (`notification_request_delete`) and move it to another case file
(`notification_request_case_file_move`). `notification_request_duplicate` works whatever
state the original is in and copies its content, its recipients **and** its attachments. It is
**asynchronous**: the copy appears in `CREATING` with zero recipients and zero documents and fills
in afterwards, so poll `notification_request_status` until `DRAFT` before inspecting it — read it
too early and it looks empty when it is not. Then review the copied recipients with
`notification_receiver_list` before sending, or you will send to the original list again.


## What the live runs confirmed (2026-09-04 and 2026-09-05)

Executed end to end against the real shared API in production with a real user key — the numbers
below are real responses, not expectations. Both deployments run the same API and the same emitted
tool code, so the behaviour applies to either.

| | |
|---|---|
| `notification_send` | created every recipient and sent — **`sent: true`** |
| Delivery | `status: SENT`, `receiverStats: { total: 1, bounced: 0, valid: 1 }` |
| Recipient row | `status: SENT`, `sendWaUrl: true`, `sendSmsUrl: true`, `emailBounced: false` — so the WhatsApp and RCS/SMS flags do take effect |
| Certificate | `notification_certificate_get` at `SENT` → `CERTIFYING → CERTIFIED`, `partial: true` |
| `document-url` | HTTP 200, `application/pdf` |

The attachment half of the run — the ordering rule and the PDF-versus-ZIP distinction — is recorded
in the **`notification-attachments`** skill, where the attachment guidance lives.

Five behaviours worth knowing that no document stated before:

- **`notification_request_update` and `notification_request_delete` return `403 Forbidden` once the
  notification has been sent.** Before the send they work. This is the API's own rule, not just what
  the interface offers.
- **`notification_request_duplicate` is asynchronous.** The copy appears immediately in `CREATING`
  with **zero** recipients and **zero** documents, and fills in afterwards. Read it too early and it
  looks empty when it is not. Poll `notification_request_status` until `DRAFT`. It does copy the
  content, the recipients and the attachments.
- **The contracted plan can be exhausted.** An integration tenant returned
  *"The contracted plan for company … has been exceeded"* on create. No retry fixes that.
- **`notification_receiver_duplicate` is not exposed.** It returns HTTP 500 on every call shape
  tried against production — source and target the same draft, across two notifications, and a
  receiver taken from a sent notification. To copy a recipient, add them again with
  `notification_receiver_add`.
- **An `INVALID` recipient blocks the send.** Clear them with `notification_receiver_invalid_purge`,
  or fix the address with `notification_receiver_update`, before calling
  `notification_request_send`.

## Attachments

Not covered here on purpose. Attaching a document forces a different order — documents before
recipients, and a wait before sending — and getting it wrong fails the send. See the
**`notification-attachments`** skill, or use `notification_send_with_attachments`.

## Example

"Send a certified notification to alice@example.com about her contract status."

```
notification_request_create
  id=<uuid>  caseFileId=<cf-id>
  type=NO_RESPONSE  subject="Your contract is ready"
  content="<p>Please review the attached information.</p>"  language=en_GB

notification_receiver_add
  id=<uuid>  caseFileId=<cf-id>  notificationRequestId=<notif-id>
  firstName="Alice"  lastName="Smith"  email="alice@example.com"

notification_request_send
  caseFileId=<cf-id>  notificationRequestId=<notif-id>

notification_request_status
  caseFileId=<cf-id>  notificationRequestId=<notif-id>
  → status=SENT, receiverStats.valid=1

notification_certificate_get
  id=<cert-uuid>  caseFileId=<cf-id>
  notificationRequestId=<notif-id>  receiverId=<receiver-id>
  language=en_GB
```

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Forget `notification_request_send` | Notification stays DRAFT forever | Always call send after adding recipients |
| Call `notification_certificate_get` before send | Certificate generation may fail — notification not sent yet | Send first, then generate the certificate |
| Waiting for a read/answer before requesting any certificate | Needless delay — a certificate is obtainable at `SENT` | TESTED: `notification_certificate_get` right after `SENT` returned `CERTIFYING → CERTIFIED` with `partial: true`. Request it at `SENT` for delivery evidence, and re-request after `FULLY_ANSWERED` for the final one. Only if it repeatedly returns `Forbidden` / `Unexpected` should you wait for the notification to progress |
| Missing `caseFileId` in receiver add | 404 or routing error | Always pass `caseFileId` alongside `notificationRequestId` |
| `otpByDefault: true` without phone number | Recipient cannot pass OTP challenge | Set `phoneNumber` + `phonePrefix` on each receiver when OTP is required |
| Plain text in `content` (no HTML tags) | Content does not render on recipient landing page | Wrap in HTML: `<p>Your text here.</p>`. Supported: `<p>`, `<strong>`, `<em>`, `<ul><li>`, `<ol><li>` |
