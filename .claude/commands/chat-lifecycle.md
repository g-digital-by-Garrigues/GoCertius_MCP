# Certified Chat Lifecycle

Create a Telegram-based certified chat session and generate a certificate (PDF) of the conversation.

## Key constraint

**Chats can only be created in the user's personal case file** — the case file created automatically when the GoCertius account was opened. Creating a chat in any other case file is not supported by the platform even if the API accepts the call. Its id is `defaultCaseFileId` in `session_info`.

## Find an existing chat (before certifying it)

When the user wants to certify a conversation that already exists, do not create a new chat:

- `chat_list` with the personal case file's `caseFileId` → pick the chat (`filter.search` matches the
  title; `filter.createdFrom` / `filter.createdUntil` narrow by creation date; `filter.status`: `creating`
  (not confirmed yet — its messages and participants answer 404), `active`, or `inactive` (not set by
  the current platform version))
- `chat_participant_list` with `caseFileId` and `chatId` → confirm who joined the Telegram group
- `chat_message_list` with `caseFileId` and `chatId` (optionally `filter.writtenFrom` / `filter.writtenTo`)
  → choose the message range to certify
- then go to step 5 below (create the certificate), keeping `chatMessagesFrom` at or after the chat's
  `registeredAt` (`chat_get`)

## Flow (new chat)

1. **Find the personal case file**
   - `session_info` → `defaultCaseFileId` is the personal case file
   - Note its `id` and `code`

2. **Create the chat**
   - `chat_create` with a generated UUID `id`, `caseFileId`, `title`, `service: "Telegram"`, `language`
   - Optional: `serviceTitle` (shown in Telegram) and `serviceDescription`
   - The chat starts in `creating` status; it transitions to `active` once the Telegram bot is registered

3. **Get the invitation URL**
   - First call `chat_get` and wait until the chat is no longer `creating` and
     `registeredAt` is present. Calling too early can return `Chat not found`
     even though `chat_create` accepted the request.
   - `chat_invitation_url` with `caseFileId` and `chatId`
   - Returns `{ invitationUrl: "https://t.me/+..." }` — share this link with all participants
   - Participants join the Telegram group; the GoCertius bot records all messages

4. **Participants chat**
   - All messages sent in the Telegram group are captured by the GoCertius bot
   - Note: `chatMessagesFrom` for the certificate must be **at or after** the chat's `registeredAt` timestamp (visible via `chat_get`)
   - `createdAt` is not a valid substitute for `registeredAt`; if
     `registeredAt` is missing, wait or ask the user to join/register the chat
     through the invitation flow before creating a certificate.

5. **Create the certificate**
   - `chat_certificate_create` with a generated UUID `id`, `caseFileId`, `chatId`, `name`, `language`
   - `chatMessagesFrom`: ISO datetime — must be **at or after** the chat's `registeredAt` (use `chat_get` to read it; an earlier value is refused with `422 lessThan: registeredAt`), and before `chatMessagesTo`
   - `chatMessagesTo`: ISO datetime — a future value is **not** refused: the platform silently caps it to the current time, so messages written later are not covered
   - The certificate is generated asynchronously but typically certifies within seconds: `DRAFT` → `CERTIFYING` → `CERTIFIED`, or back to `DRAFT` if certification fails

6. **Retrieve the certificate**
   - `chat_certificate_get` with `caseFileId`, `chatId`, `id` (certificate UUID)
   - Returns status (`CERTIFIED`), validity period (3 years by default), message range, metadata, and `documentUrl` (PDF download link — only present when `status: CERTIFIED`)
   - Certificate code follows the pattern `<caseFileCode>_CH<n>_D<m>`

## Example

"Certify the Telegram conversation that happened today in my personal case file."

```
session_info                              → defaultCaseFileId (the personal case file)
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
| Request invitation while status is `creating` | API can return `Chat not found` | Poll `chat_get` until the chat is active/registered |
| Certificate before `registeredAt` exists | Error `Can not create a chat certificate without registered at` | Wait for the Telegram bot/chat registration and use `registeredAt` |
| `chatMessagesFrom` before `registeredAt` | Validation error `lessThan: registeredAt` | Use `chat_get` to read `registeredAt`, and set `from` to it or later |
| Missing `caseFileId` in `chat_certificate_get` | API returns empty error | Always pass `caseFileId` — it's required even though some clients hide it |
