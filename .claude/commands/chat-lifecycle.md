# Certified Chat Lifecycle

Create a certified real-time chat session between multiple parties and obtain the legal certificate.

## Parameters

- `case_file_id` (required): UUID of the case file to associate the chat with
- `participants` (required): List of participant email addresses
- `subject` (optional): Subject or purpose of the chat session
- `use_case_id` (optional): Use case template ID to apply

## Flow

1. **Find or create a case file** — use `case_file_list` or `case_file_get` to identify the case context. Chats must be associated with a case file.

2. **Create the chat** — call `chat_create` with the case file ID and participant list. An invitation URL is generated for each participant.

3. **Share invitation** — the invitation URL (from `chat_create` response) is sent to participants so they can join the certified chat session.

4. **Wait for completion** — monitor the chat status. When all parties have completed their interaction, the chat can be closed.

5. **Get the certificate** — call `chat_certificate_get` with the chat ID to retrieve the certified chat transcript as a legal document (PDF).

## Example

"Create a certified chat between legal@garrigues.com and client@company.com for contract negotiation, then get the transcript certificate."

Tool sequence: `case_file_get` → `chat_create` → `chat_certificate_get`
