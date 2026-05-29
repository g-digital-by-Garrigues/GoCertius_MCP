# Getting Started (GoCertius)

Essential concepts and first steps for any workflow with GoCertius.

## Step 0 — Authenticate

Always call this first. Authentication is automatic — the server reads credentials from its environment:

```
session_login()
```

Returns `{ authenticated: true, userId: "<uuid>", ... }`. Save `userId` — you need it to list or create case files.

Alternatively, if you already have a valid session and just need `userId` without re-authenticating:
```
session_info()  →  { userId: "<uuid>", type: "Password" }
```

## Step 1 — Find or create your case file

Every operation in GoCertius requires a `caseFileId`. Case files are workspaces that group all your documents and processes.

**List existing case files:**
```
case_file_list(userId: "<uuid-from-session-login>")
```

Use the `id` field (a UUID), **not** the `code` (like `GN652`).

**Create a new case file (if needed):**
```
case_file_create(
  id: "<new-uuid>",
  name: "My Case File",
  description: "Optional description",
  useCaseId: "<uuid>"    # reuse from an existing case file in your account
)
```

To find a valid `useCaseId`: call `case_file_list`, pick any case file, and reuse its `useCaseId`.

> **Chats** are special — they can only be created in your **personal case file** (the oldest one owned by you). See `/chat-lifecycle` for details.

## Step 2 — Generate valid UUIDs

Every resource you create requires a unique `id` you supply. The API validates strict UUID v4 format.

**The 4th group of the UUID must start with `8`, `9`, `a`, or `b`.**

Safe ways to generate valid UUIDs:

```bash
# macOS / Linux
python3 -c "import uuid; print(uuid.uuid4())"

# Node.js
node -e "const {randomUUID} = require('crypto'); console.log(randomUUID())"
```

❌ Do NOT invent UUIDs like `c3d4e5f6-a7b8-4901-cdef-...` — the `cdef` 4th group fails validation.
✅ A valid example: `4dbee9f1-2fcf-4ff9-aa50-53e72d99b617` (4th group `aa50` starts with `a`).

## Common first-time mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Using case file `code` (GN652) instead of `id` | 404 Not Found | Use `id` UUID from `case_file_list` |
| Not calling `session_login` first | 401 Unauthorized | Always authenticate before calling any other tool |
| Invalid UUID in any `id` field | Validation error | 4th group must start with `8`, `9`, `a`, or `b` |
| Leaving an evidence group unsealed | Group stays OPEN forever, never certified | Always call `evidence_seal` after adding all evidence items |
| Creating a chat in the wrong case file | Platform rejects the chat | Chats only work in the personal case file (oldest, owned by you) |
| `chatMessagesFrom` before `registeredAt` | Validation error | Check `registeredAt` via `chat_get` before creating certificate |

## Quick reference

| I want to... | Tool(s) |
|---|---|
| Authenticate | `session_login` |
| List my case files | `case_file_list` (needs `userId`) |
| Create a case file | `case_file_create` |
| Certify evidence | See `/evidence-lifecycle` |
| Create a certified dossier | See `/dossier-lifecycle` |
| Send a certified notification | See `/notification-lifecycle` |
| Start a certified Telegram chat | See `/chat-lifecycle` |
