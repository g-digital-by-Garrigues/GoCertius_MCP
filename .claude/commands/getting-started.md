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
session_info()  →  { userId: "<uuid>", type: "UserKey", accountLoginType: "Password" }
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

## Credentials are managed by a human — not by you

This server authenticates itself from its own environment (`MCP_AUTH_USER_KEY`). There is **no tool
to create, list or revoke a user key**, and that is deliberate: the API returns a new key's secret
exactly once, so minting one here would write a long-lived credential into this conversation — and
conversations are logged, summarised and shared.

The three failure modes are not the same thing. If the credential is **missing**, the server does
not start at all — it fails closed with an auth-config error rather than booting unauthenticated,
so you will never get as far as a tool call. If it is **expired or revoked**, tools return `401` at
call time. Either way: say what happened and stop; do not try to work around it. The fix is a human one: the account owner mints a key, puts it in the server's
environment, and restarts the server. The procedure is in the project's credential-rotation
runbook.

**Never ask anyone to paste a key into the chat.** If one appears here anyway, tell them to revoke
it — it must be treated as compromised.

Expect this to change. The platform's authentication model is still settling: a future version may
require a second factor to mint a key, or remove that ability from the API altogether. A `401` that
appears without the key having expired is worth reporting rather than retrying.

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
