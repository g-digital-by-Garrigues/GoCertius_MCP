# Certified Chat Lifecycle

Create a Telegram-based certified chat session and generate a tamper-evident certificate of the conversation.

## Key constraint

**Chats can only be created in the user's personal case file** — the case file created automatically when the GoCertius account was opened. Creating a chat in any other case file is not supported by the platform even if the API accepts the call. Use `session_info` → `case_file_list` to find the personal case file (typically the oldest one, owned by the user).

## Flow

1. **Find the personal case file**
   - `session_info` → get `userId`
   - `case_file_list` with `userId` → find the personal case file (oldest `createdAt`, owned by the user)
   - Note its `id` and `code`

2. **Create the chat**
   - `chat_create` with a generated UUID `id`, `caseFileId`, `title`, `service: "Telegram"`, `language`
   - Optional: `serviceTitle` (shown in Telegram) and `serviceDescription`
   - The chat starts in `creating` status; it transitions to `active` once the Telegram bot is registered

3. **Get the invitation URL**
   - `chat_invitation_url` with `caseFileId` and `chatId`
   - Returns `{ invitationUrl: "https://t.me/+..." }` — share this link with all participants
   - Participants join the Telegram group; the GoCertius bot records all messages

4. **Participants chat**
   - All messages sent in the Telegram group are captured by the GoCertius bot
   - Note: `chatMessagesFrom` for the certificate must be **after** the chat's `registeredAt` timestamp (visible via `chat_get`)

5. **Create the certificate**
   - `chat_certificate_create` with a generated UUID `id`, `caseFileId`, `chatId`, `name`, `language`
   - `chatMessagesFrom`: ISO datetime — must be ≥ chat `registeredAt` (use `chat_get` to confirm)
   - `chatMessagesTo`: ISO datetime — can be now or any future point
   - The certificate is generated asynchronously but typically certifies within seconds

6. **Retrieve the certificate**
   - `chat_certificate_get` with `caseFileId`, `chatId`, `id` (certificate UUID)
   - Returns status (`CERTIFIED`), validity period (3 years by default), message range, and metadata
   - Certificate code follows the pattern `<caseFileCode>_CH<n>_D<m>`

## Example

"Certify the Telegram conversation that happened today in my personal case file."

```
session_info                              → userId
case_file_list  userId=<uuid>            → personal caseFileId
chat_create     id=<uuid>  caseFileId=<id>  title="..."  service=Telegram  language=es_ES
chat_get        caseFileId=<id>  chatId=<uuid>   → check registeredAt
chat_invitation_url  caseFileId=<id>  chatId=<uuid>   → share https://t.me/+...
[participants join and exchange messages]
chat_certificate_create  id=<cert-uuid>  caseFileId=<id>  chatId=<uuid>
  name="Certificado conversación"  language=es_ES
  chatMessagesFrom=<registeredAt or later>  chatMessagesTo=<now>
chat_certificate_get  caseFileId=<id>  chatId=<uuid>  id=<cert-uuid>  → CERTIFIED
```

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Wrong case file | Chat created but platform rejects it as invalid | Always use the user's personal case file |
| `chatMessagesFrom` before `registeredAt` | Validation error `lessThan: registeredAt` | Use `chat_get` to check `registeredAt`, set `from` ≥ that value |
| Missing `caseFileId` in `chat_certificate_get` | API returns empty error | Always pass `caseFileId` — it's required even though some clients hide it |
