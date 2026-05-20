# Notification Lifecycle

Send certified electronic notifications via GoCertius and retrieve the legal certificate.

## Parameters

- `subject` (required): Subject line of the notification
- `body` (required): Body text of the notification (plain text or HTML)
- `recipient_email` (required): Email address of the recipient
- `recipient_name` (optional): Full name of the recipient
- `case_file_id` (optional): UUID to associate the notification with an existing case file

## Flow

1. **Create a notification request** — call `notification_request_create` with subject, body, and initial metadata. This is a long-running operation (pollable) — a task ID is returned immediately.

2. **Add recipients** — call `notification_receiver_add` with the recipient's email and name. A single notification request can have multiple recipients.

3. **Monitor delivery** — use `notification_request_status` with the notification ID to check the current status (pending → sent → delivered → read).

4. **Retrieve the certificate** — once delivered, call `notification_certificate_get` to generate the legal notification certificate (PDF + blockchain-anchored).

## Example

"Send a certified notification to alice@example.com informing her that her contract is ready to sign."

Tool sequence: `notification_request_create` → `notification_receiver_add` → `notification_request_status` → `notification_certificate_get`
