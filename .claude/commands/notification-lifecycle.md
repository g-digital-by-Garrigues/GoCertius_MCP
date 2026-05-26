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

## Flow

1. **Create the notification request** (stays DRAFT)
   - `notification_request_create` with a generated UUID `id`, `caseFileId`, `type`, `subject`, `content`, `language`
   - Optional: `otpByDefault: true` to require SMS OTP for all recipients

2. **Add recipients** (one call each, up to 25)
   - `notification_receiver_add` with a generated UUID `id`, `notificationRequestId`, `caseFileId`, `firstName`, `lastName`, `email`
   - Optional: `phoneNumber` + `phonePrefix` when OTP is required; `otpRequired: true` per recipient

3. **Send the notification**
   - `notification_request_send` with `caseFileId` and `notificationRequestId`
   - Returns immediately — delivery is async; status transitions to `SENT`

4. **Monitor delivery**
   - `notification_request_status` with `caseFileId` and `notificationRequestId`
   - Check `status` and `receiverStats` (total / bounced / valid)

   **Completion detection:**

   | Runtime | Approach |
   |---|---|
   | Claude Code / n8n (standard `callTool`) | Poll `notification_request_status` until `status: DELIVERED` |
   | Task-capable MCP client (experimental task streaming) | Server pushes completion via SSE when notification is delivered — no polling needed |

5. **Generate per-receiver certificates** (once SENT or later)
   - `notification_certificate_get` with a generated UUID `id`, `caseFileId`, `notificationRequestId`, `receiverId`, `language`
   - Creates an intermediate certificate immediately after sending; re-call after `FULLY_ANSWERED` for the final certificate

## Example

"Send a certified notification to alice@example.com about her contract status."

```
notification_request_create
  id=<uuid>  caseFileId=<cf-id>
  type=NO_RESPONSE  subject="Your contract is ready"
  content="Please review the attached information."  language=en_GB

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
| Missing `caseFileId` in receiver add | 404 or routing error | Always pass `caseFileId` alongside `notificationRequestId` |
| `otpByDefault: true` without phone number | Recipient cannot pass OTP challenge | Set `phoneNumber` + `phonePrefix` on each receiver when OTP is required |
