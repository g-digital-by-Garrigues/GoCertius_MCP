---
name: gocertius-suite-api
version: 1.1.0
updated: 2026-11-26
description: 'Integration guide for the GoCertius / EAD Enterprise Suite REST API (one shared spec, two deployments). Covers authentication (long-lived user keys — the recommended flow — and password sessions), the case-file resource model incl. case-file update, and the exact ordered call sequences for evidence capture (incl. resumable large-file uploads on EAD Enterprise Suite, and evidence / evidence-group maintenance), dossier certification, e-signature (simple (interposition), advanced and with certificate; both deployments) incl. downloading the signed document + completion certificate, certified notifications (email/WhatsApp) incl. delivery certificates, and certified chats (incl. listing chats, messages and participants) — plus enums, options, and known gotchas. Use when writing or debugging any code that talks to this API directly.'
---

# GoCertius / EAD Enterprise Suite — API Integration Guide

> **Skill version 1.1.0 — updated 2026-11-26.** See the [Changelog](#changelog) at the end. Authentication facts about the REST API are stated as of 2026-07-18; the user-key endpoints are being promoted to production (see §1). The 2026-11-26 revision adds e-signature on GoCertius, case-file update, large-file uploads, evidence and evidence-group maintenance, and chat listing.

GoCertius and EAD Enterprise Suite are the **same API** behind two deployments. They share one OpenAPI contract and differ only in base URL and **which products each deployment has enabled**. Everything in this guide applies to both, but check the product table below before calling an endpoint — a resource that isn't enabled on your deployment won't work.

| Deployment | Base URL | Interactive docs |
|---|---|---|
| GoCertius | `https://api-gocertius.gocertius.io` | `https://api-gocertius.gocertius.io/apidoc/` |
| EAD Enterprise Suite | `https://api-eadcustody.eadtrust.gocertius.io` | (same OpenAPI, EAD host) |

### Products enabled per deployment

| Product | GoCertius | EAD Enterprise Suite |
|---|:---:|:---:|
| Evidence capture | ✅ | ✅ |
| Dossiers (evidence certificates) | ✅ | ✅ |
| Certified notifications | ✅ | ✅ |
| **E-signature** | ✅ | ✅ |
| **Chats** (certified conversations) | ✅ | ❌ |
| **Large evidence uploads** (resumable, §3) | ❌ | ✅ |

Both deployments do evidence + dossiers + notifications + e-signature. **Chats are GoCertius-only.** **Large (resumable, multipart) evidence uploads are EAD-Enterprise-only:** `GET /settings` → `featureFlags.largeEvidenceUploads` is on in EAD Enterprise Suite and off in GoCertius, and every large-upload endpoint is refused while it is off. The dossier **templates also differ** (see §4): GoCertius ships one standard template; EAD Enterprise exposes editable templates. So does **evidence embedding** in the dossier certificate (§4).

> Fetch the live OpenAPI JSON from the `/apidoc/` Swagger UI on your base host to resolve exact field-level schemas. This guide gives you the flows, options, and traps that the raw spec does *not* make obvious.
>
> **Provenance:** items marked ✅ **Tested** were executed against the live API on 2026-07-02…18 — auth (incl. the legal-texts gate, the **user-key exchange**, and **`GET /profile`** for identity), the full evidence flow, pagination, and the **chat + chat-certificate** flow against GoCertius production; the full **dossier / evidence-certificate** lifecycle (templates, fields, password, preview, certify, download, visibility, delete, express), **e-signature** (INTERPOSITION) build + **signed-document / completion-certificate download**, and **certified notification** (email + WhatsApp) + **delivery-certificate** flows against EAD Enterprise Suite. The two deployments share one contract, so contract-level flows apply to both — but respect the per-deployment product table above. Anything without a ✅ is spec-derived.

---

## 1. Authentication

All business endpoints require `Authorization: Bearer <jwt>`. There are two supported ways to obtain that JWT:

| How | Endpoint | Session | When to use |
|---|---|---|---|
| **User key** *(recommended)* | `POST /user-keys/session` | ~24 h | Headless / server-to-server: a long-lived key, no password in config. The predominant method — see the rollout note. |
| **Password** | `POST /session` | ~1 h | Interactive logins, and to mint a user key from. Fully supported everywhere *at the API level* — but **not** by the MCP servers / n8n node, which take a user key only (see [Password accounts](#password-accounts)). |

> **User-key rollout (as of this guide's date, 2026-07-18).** User keys are the intended default for automated integrations and are being promoted to production imminently. **Password login is available on every host and remains fully supported** — use it for interactive sessions, and as the fallback wherever the user-key endpoints are not yet live on your target host.

**Account types.** `GET /session-info/{email}` reports an account's type (`Password` or `OpenId`). You need a **`Password`-type account** to use this API — either to log in directly, or to mint a user key from it.

> **OpenId (Azure AD) accounts cannot authenticate through this API.** The deployed OpenID clients are confidential apps whose secret is not provisioned to integrations, so there is no API-usable token exchange. If your account is `OpenId`-type, use a Password account instead — or a user key minted from one (an admin can issue the key out-of-band).

### User keys — the recommended flow (headless, no password in config)

A **user key** is a long-lived credential that you exchange for a short-lived session JWT. It is the intended way to run an integration without storing an account password, and it carries the identity and permissions of the user who minted it. **You choose its lifetime** via `expiresAt` on create — 12 months is a typical choice.

**The key is not the token.** A user key does **not** work as a `Authorization: Bearer` value on business endpoints — this is the single most common mistake. It goes in the **body** of the exchange call, and the `jwt` you get back is what you send as the Bearer:

```bash
# Exchange the long-lived key for a session JWT (no Authorization header on this call)
curl -s -X POST "$BASE/user-keys/session" \
  -H "Content-Type: application/json" \
  -d '{"key":"'"$USER_KEY"'"}'
# → 201 { "jwt": "eyJ..." }   ← session token, ~24 h, payload.sessionType = "UserKey"
```

Then use that `jwt` exactly like a password-session JWT (`Authorization: Bearer <jwt>` on every call). Cache it and re-exchange on expiry — the key itself is reusable until it expires or is revoked, so **do not call `/user-keys/session` on every request**; exchange once, reuse the JWT, and refresh shortly before its `exp`.

**A user-key session has no email of its own** — so use `GET /profile` (below), not `/session-info/{email}`, to learn who you are and get your `userId`.

> ⚠️ **Key management is human-gated — deliberately.** The four `/user-keys` endpoints are the only
> place in this API where a long-lived credential is created, listed or destroyed, and the create
> response is the one and only moment the secret exists in readable form. Treat them as a human
> operation, not an automated one:
>
> - **An agent should not call them.** The MCP servers built on this API expose **no tool** for any
>   of the four, on purpose. An agent that mints a key writes the secret into its own transcript,
>   and transcripts are logged, summarised, replayed and often shared.
> - **Never ask a person to paste a key into a chat.** Have them write it to a file with
>   restrictive permissions (`chmod 600`) or set it as an environment variable, and point the
>   integration at that. If a key ever does reach a transcript, treat it as compromised and revoke
>   it — `DELETE /user-keys/{id}` is the whole remedy.
> - **A key carries the full identity and permissions of whoever minted it**, including everything
>   an admin can do if it was minted from an admin account. There is no reduced scope, no
>   per-endpoint restriction and no audit of which integration used it.
> - **Expect this surface to change.** It depends on whatever authentication model the platform
>   settles on. A future model may require a second factor to mint or revoke a key, or withdraw
>   these endpoints from the API altogether for security reasons. Do not build a product feature on
>   top of them; use them the way you would use a password-reset page.

**Managing keys** (these calls *are* authenticated — you need a session JWT first, so a key is always minted from a password login or an existing session):

```bash
# Create — returns the secret ONCE. Store it now; it is not retrievable later.
curl -s -X POST "$BASE/user-keys" -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"id":"<uuid-v4-you-generate>","name":"ci-integration","expiresAt":"2027-07-17T00:00:00.000Z"}'
# → 201 { "key": "<base64(keyId)>___<base64(secret)>" }

# List — metadata only; keyHead/keyTail are a masked fingerprint, never the full secret
curl -s "$BASE/user-keys?filter[expired]=false&page[size]=20" -H "Authorization: Bearer $JWT"
# → 200 { data:[{ id, name, keyHead, keyTail, expiresAt, createdAt }], meta:{ totalElements } }

# Revoke
curl -s -X DELETE "$BASE/user-keys/{userKeyId}" -H "Authorization: Bearer $JWT"   # → 204
```

Notes that matter:
- `id`, `name` (≤100 chars) and `expiresAt` are all **required** on create; you generate the `id` (UUID v4) client-side, as everywhere else in this API.
- The full key is returned **only** in the create response. There is no "show key" endpoint — `list` gives you `keyHead`/`keyTail` so you can identify which key a stored secret corresponds to, and nothing more. Lose it and you mint a new one.
- The key's shape (`base64(keyId)___base64(secret)`, triple underscore) is an implementation detail — treat it as an opaque string.
- Rotation: create the new key, deploy it, then `DELETE` the old one. Keys are independent, so old and new work in parallel during the switchover.
- Assume that revoking a key does **not** invalidate session JWTs already exchanged from it — the JWT is self-contained, so an issued session plausibly lives out its ~24 h. *(Inferred, not verified — if you need hard revocation, verify it against your environment first.)*

> ✅ **Tested** (2026-07-16): `POST /user-keys/session` with `{"key":"<12-month key>"}` → `201 {jwt}`; the JWT's payload carries `sessionType:"UserKey"` and an ~24 h `exp`, and it authenticates business endpoints normally as a Bearer. Presenting the **key itself** as a Bearer returns `401` — the exchange is mandatory.

### Password accounts

Fully supported everywhere, and the way to bootstrap a user key.

> **If you arrived here from the MCP server or the n8n node, they no longer take a password.**
> Since 2026-09 the GoCertius / EAD Enterprise Suite **MCP servers and the n8n node accept one
> credential only: a user key**, in `MCP_AUTH_USER_KEY` (plus `MCP_API_BASE_URL`, which is
> required). Their email/password and pre-seeded-JWT settings were removed; a stale config does
> not fail at startup, it fails every tool call with "No credentials configured".
> **This does not deprecate anything in this section.** `POST /session`, the legal-texts gate and
> `/session-with-legal-texts` are unchanged REST behaviour, still correct for any direct
> integration — and a password login is still **how you mint the user key** those clients need
> (`POST /user-keys`, above; the management endpoints require a session).

```
POST /session   { "email", "password" }   →   { "jwt": "..." }
```

**The legal-texts gate.** If the account hasn't accepted the current terms, `POST /session` returns **HTTP 409** with `{ "info": { "pendingLegalTextCodes": ["SERVICE_TERMS", ...] } }` instead of a JWT. Resolve it once:
```bash
# 1. fetch the current legal texts to get the id of each pending code
curl -s "$BASE/legal-texts?language=es_ES" | jq '.data[] | {code, id, version}'
# 2. log in accepting them
curl -s -X POST "$BASE/session-with-legal-texts" -H "Content-Type: application/json" -d '{
  "email":"'"$EMAIL"'", "password":"'"$PASS"'", "legalTextLanguage":"es_ES",
  "acceptServiceTermId":"<id of the SERVICE_TERMS text>"
}'   # → HTTP 201 { "jwt": "..." }
```
`acceptPrivacyPolicyId` is the analogous field if `PRIVACY_POLICY` is pending. A production JWT is a normal 3-part token; for a password session `payload.sub` carries your `userId` — but prefer `GET /profile` (below), which works on any flow.

> ✅ **Tested** (production, 2026-07-02): `GET /session-info/{email}` → `type: "Password"`; a bare `POST /session` returned `409` with `pendingLegalTextCodes:["SERVICE_TERMS"]`; `GET /legal-texts?language=es_ES` returned `.data[]` with `{code:"SERVICE_TERMS", id, version:6}`; `POST /session-with-legal-texts` with that id → `201` + JWT whose `sub` is the userId.

### Resolving your identity — `GET /profile`

Most user-scoped endpoints need your **`userId`** (a UUID) in the path — e.g. `GET /users/{userId}/case-files`. Get it from `GET /profile`, which identifies you from the session token alone:

```bash
curl -s "$BASE/profile" -H "Authorization: Bearer $JWT"
# → 200 { "id": "<userId>", "email", "companyId", "defaultCaseFileId", "loginInfo": { "type" }, ... }
```

- **`id` is your `userId`** — the value the `/users/{userId}/...` routes expect.
- Also returns `companyId` (needed to subscribe to the notifications SSE stream `/notifications/sse/{companyId}`), `defaultCaseFileId` (your personal case file — the one certified chats must use), and `loginInfo.type`.
- **Use `/profile`, not `/session-info/{email}`, to answer "who am I".** `/session-info` is keyed on an email and only reports the *account type*; it is useless on the user-key flow, which has no email. `/profile` works identically on both flows.

> ✅ **Tested**: `GET /profile` is live in **production** on both hosts (2026-07-18: `401` unauthenticated, and present in the production OpenAPI). The `id`→`userId` mapping is from the spec schema (`ShowProfileRepresentation.id`, required) and was exercised end-to-end on the user-key flow.

### Using the token
Whichever flow produced it, the JWT is used identically:

- Send `Authorization: Bearer <jwt>` on every subsequent call. Never send a *user key* here — only the exchanged JWT.
- **Get your `userId` from `GET /profile` → `id`** (above); it works on any flow. A *password*-session JWT also carries it in `payload.sub`, but **do not rely on the `sub` claim for a user-key session** — resolve identity via `/profile` instead. Several endpoints need this UUID, *not* the email — e.g. `GET /users/{userId}/case-files`, and any `ownerId` filter.
- Session lifetime: **~1 hour** for a password session, **~24 hours** for a user-key session (`payload.sessionType` tells you which: `UserKey` vs a password session). Don't hardcode either — read `payload.exp` and refresh a minute or so before it.
- Re-authenticating means repeating whichever flow you used (`POST /session` or `POST /user-keys/session`); there is no refresh-token endpoint on the GoCertius side.
- `DELETE /session` logs out.

---

## 2. The resource model

Almost everything hangs off a **Case File** (`caseFileId`) — the container for a matter/dossier of work. Under it live the product workflows:

```mermaid
graph TD
    CF[Case File] --> EG[Evidence Groups → Evidences]
    CF --> DOS[Dossiers · certified reports]
    CF --> SIG[Signature Requests → Documents → Participants]
    CF --> NOT[Notification Requests → Receivers + Documents]
    CF --> CH[Chats → Messages → Chat Certificates]
    EG -.linked into.-> DOS
```

**Every operation needs a `caseFileId`.** You don't have to *create* one each time — you need to **declare which case file the work belongs to**. Either reuse/look up an existing one or create a new one:
```
GET  /users/{userId}/case-files      # search/list a user's case files (paginated — see pagination note in §3)
POST /case-files   { "id": <uuid>, "name", "useCaseId": <uuid>, "reference"?, "description"? }   # create
PUT  /case-files/{caseFileId}   { "status"?, "name"?, "reference"?, "description"? }          # update → 204
```
`useCaseId` is required on create and tenant-specific — list the ones your account can use via `GET /use-cases` → `{ data:[ { id, code, translations:[{name,language}] } ], meta }` (tested). Each use-case has a `code` (e.g. `PR` = "Personal"). ⚠️ The `PR`/personal use-case allows only **one** case file per account — a second create returns `422 { useCaseId:[personalCaseFileAlreadyExists] }`; use a general use-case for programmatic creation. `id` is a **client-generated UUID** (see idempotency below).

**Updating a case file.** `PUT /case-files/{caseFileId}` takes `status` (`OPEN` or `CLOSED`), `name`, `reference` (≤ 32 chars) and `description`, all optional, and answers `204` with no body — read it back with `GET /case-files/{caseFileId}`. It needs the editor role or higher on the case file, and the personal case file is refused (`403`). Every case file is created `OPEN`. While it is `CLOSED`, `POST /evidence-groups` and `POST /evidences` are refused with `409 { "code": "CaseFileStatusNotOpen", … }` until it is set back to `OPEN`; the large-upload create (§3) does not check it.

### Three conventions that apply everywhere

1. **Client-supplied UUIDs = idempotency.** Nearly every create takes an `id` (`format: uuid`) *you* generate (`crypto.randomUUID()`). Reusing the same id makes a retry idempotent instead of creating a duplicate. Always send real UUIDs — arbitrary strings are rejected.

2. **The hash + upload-url pattern for every file.** You never POST raw bytes to the JSON API. Instead:
   ```
   1. Compute sha-256 of the file — you need it in TWO encodings:
        • hex    → goes in the JSON `hash` field
        • base64 → goes in the S3 upload header (see below)
   2. POST the metadata (hash=hex, fileName, ...) → API returns a short-lived presigned { uploadFileUrl }.
   3. PUT the raw bytes to that url with header  x-amz-checksum-sha256: <base64 sha-256>
   ```
   This holds for evidences, signature documents, and notification attachments alike. **Exception:** the resumable **large-file multipart** path (see §3) takes no client hash at all — GoCertius computes the sha-256 server-side after recomposing the chunks.

   > ⚠️ **The `x-amz-checksum-sha256` header is mandatory and undocumented.** The presigned URL is signed with `SignedHeaders=host;x-amz-checksum-sha256`, so a plain `PUT` (or one with only `Content-Type`) fails with **`403 SignatureDoesNotMatch`**. The value is the **base64** sha-256 of the bytes — not the hex you put in `hash`. In shell: `openssl dgst -sha256 -binary file | openssl base64`.

3. **Async work is the norm — poll responsibly, or subscribe to events.** Sealing evidence, certifying a dossier, processing a signature document, and generating certificates are all **asynchronous** (they transition through states and typically settle in ~10–30 s). Two rules:
   - **Prefer events over polling.** For notifications, subscribe to the Server-Sent Events stream `GET /notifications/sse/{companyId}` (resume with the `Last-Event-ID` header) instead of polling status. Use polling only where no event stream exists.
   - **When you must poll, bound it.** Wait **≥5 s between attempts** (a first delay of ~3–5 s, then a fixed 5 s interval or exponential backoff capped at ~15 s), and cap total attempts — **~10–12 tries (≈60 s) is plenty** for these operations. If the state hasn't settled by then, **stop and surface a timeout / check again later** — do **not** keep looping. Never poll in a tight loop, never below ~5 s, and never fan out many concurrent polls: a hot retry loop looks like a DDoS and will get you throttled or blocked. Every "poll until …" instruction in this guide inherits these limits.

---

## 3. Evidence capture

Evidence lives in a **group** (a batch sharing a capture type). Flow:

```
1. POST /evidence-groups
      { "id":<uuid>, "caseFileId", "evidenceType":"FILE", "name", "description"? }
2. POST /evidences
      { "id":<uuid>, "caseFileId", "evidenceGroupId", "hash":<hex>, "title",
        "custodyType":"EXTERNAL", "fileName" }
3. POST /case-files/{caseFileId}/evidence-groups/{evidenceGroupId}/evidences/{id}/upload-url
      { "hash":<hex>, "fileName" }                 → { "uploadFileUrl", "expiration" }
4. PUT <uploadFileUrl>   (raw bytes) with header  x-amz-checksum-sha256: <base64 sha-256>
5. POST /case-files/{caseFileId}/evidence-groups/{evidenceGroupId}/close
      { "evidencesCount":<n>, ...device/location? }
```
Closing seals the group: OPEN → CLOSING → CLOSED (`evidencesCount` = the number of evidences in it). Device and geolocation fields on `close` are optional context that strengthens the evidential value. Processing is async — poll `GET .../evidences/{id}` until `status` is `COMPLETED` (its file is processed) and the group until it is `CLOSED` (bounded polling per §2.3: every ~5 s, max ~12 attempts).

| Option | Field | Values |
|---|---|---|
| Capture type | `evidenceType` | `FILE` · `PHOTO` 🔒 · `VIDEO` 🔒 · `WEB_PLUGIN` 🔒 |
| Custody | `custodyType` | `EXTERNAL` (you hold the file) · `INTERNAL` (GoCertius custody) |

> 🔒 **`PHOTO`, `VIDEO`, and `WEB_PLUGIN` are secured capture types — a plain API integration cannot use them.** They represent captures taken *inside* the official GoCertius/Suite mobile apps or browser extension, and the API only accepts them with a valid device/app **`attestation`**. The `attestation` object (on `POST .../evidence-groups` and on `close`) is `{ "provider":"AppAttest"|"PlayIntegrity", "app":"App"|"AppPro", "token", "keyId", "assertion" }` — an Apple **App Attest** or Google **Play Integrity** token that can only be produced by the genuine signed app (also registered via `POST /app-attest/attestations`). It cannot be forged by a third-party integration, so a create/close for `PHOTO`/`VIDEO`/`WEB_PLUGIN` **is rejected without the matching attestation**. **For a server-to-server integration, use `evidenceType: "FILE"`** — it needs no attestation.

> **Large files:** for multi-GB uploads on EAD Enterprise Suite, use the resumable multipart path — see [Large files](#large-files-resumable-multipart--ead-enterprise-suite-only) below.

### Tested end-to-end walkthrough (curl)

> ✅ Executed against production `https://api-gocertius.gocertius.io` on 2026-07-02; every status below is a real response. `$JWT` is the token from §1, `$UC` a `useCaseId` from `GET /use-cases`.

```bash
BASE=https://api-gocertius.gocertius.io
CF=$(uuidgen|tr A-Z a-z); GRP=$(uuidgen|tr A-Z a-z); EV=$(uuidgen|tr A-Z a-z)
HEX=$(shasum -a 256 file.txt | awk '{print $1}')                 # → JSON `hash`
B64=$(openssl dgst -sha256 -binary file.txt | openssl base64)    # → S3 checksum header

# 1) case file (201).  NOTE: some use-cases require `description` even though the
#    base schema marks it optional — omit it and you get 422 { description:[isDefined] }.
curl -s -X POST "$BASE/case-files" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"id\":\"$CF\",\"name\":\"demo\",\"description\":\"demo\",\"useCaseId\":\"$UC\"}"

# 2) evidence group (201)
curl -s -X POST "$BASE/evidence-groups" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"id\":\"$GRP\",\"caseFileId\":\"$CF\",\"evidenceType\":\"FILE\",\"name\":\"grp\"}"

# 3) register evidence (202)
curl -s -X POST "$BASE/evidences" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"id\":\"$EV\",\"caseFileId\":\"$CF\",\"evidenceGroupId\":\"$GRP\",\"hash\":\"$HEX\",\"title\":\"ev\",\"custodyType\":\"EXTERNAL\",\"fileName\":\"file.txt\"}"

# 4) presigned upload url (201) → { uploadFileUrl, expiration }
URL=$(curl -s -X POST "$BASE/case-files/$CF/evidence-groups/$GRP/evidences/$EV/upload-url" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"hash\":\"$HEX\",\"fileName\":\"file.txt\"}" | jq -r .uploadFileUrl)

# 5) upload bytes (200) — the checksum header is what makes S3 accept it
curl -s -X PUT -T file.txt -H "x-amz-checksum-sha256: $B64" "$URL"

# 6) close the group (202)
curl -s -X POST "$BASE/case-files/$CF/evidence-groups/$GRP/close" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"evidencesCount":1}'

# 7) poll the evidence until processed → { "status": "COMPLETED", ... }.  Bounded: sleep 5s, stop after ~12 tries.
curl -s "$BASE/case-files/$CF/evidence-groups/$GRP/evidences/$EV" -H "Authorization: Bearer $JWT" | jq .status
```

**Pagination gotcha (tested):** list endpoints use bracketed, **1-based** paging — `?page[number]=1&page[size]=20` (curl needs `-g` to keep the brackets). Flat `?page=1&size=20` fails with `{ "page":[{"error":"nestedValidation"}] }`. Responses are shaped `{ "data": [...], "meta": { "totalElements": N } }`.

**The same upload, in TypeScript** (steps 4–5 — the reusable part). The dual-encoding hashing below is verified to produce byte-identical hex/base64 to the tested `openssl`/`shasum` commands:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

async function uploadEvidenceFile(opts: {
  base: string; jwt: string; caseFileId: string; groupId: string; evidenceId: string; filePath: string; fileName: string;
}) {
  const bytes = await readFile(opts.filePath);
  const digest = createHash("sha256").update(bytes).digest();
  const hex = digest.toString("hex");        // → JSON `hash`
  const b64 = digest.toString("base64");     // → x-amz-checksum-sha256

  const auth = { Authorization: `Bearer ${opts.jwt}`, "Content-Type": "application/json" };

  const { uploadFileUrl } = await fetch(
    `${opts.base}/case-files/${opts.caseFileId}/evidence-groups/${opts.groupId}/evidences/${opts.evidenceId}/upload-url`,
    { method: "POST", headers: auth, body: JSON.stringify({ hash: hex, fileName: opts.fileName }) },
  ).then((r) => r.json());

  const put = await fetch(uploadFileUrl, {
    method: "PUT",
    headers: { "x-amz-checksum-sha256": b64 }, // ← without this: 403 SignatureDoesNotMatch
    body: bytes,
  });
  if (!put.ok) throw new Error(`S3 upload failed: ${put.status}`);
}
```

### Large files (resumable multipart) — EAD Enterprise Suite only

For files too big for one presigned `PUT`. Refused on GoCertius (`featureFlags.largeEvidenceUploads` is off there). Read the limits first: `GET /settings` → `largeEvidenceChunkSizeMB` (the chunk size; 1000 on EAD Enterprise Suite production) and `maxLargeEvidenceSizeMB` (the cap; 125000 MB on EAD Enterprise Suite, a platform setting — see the unit note below). *(Spec- and source-derived; not yet exercised end to end against the live API.)*

```
G = /case-files/{caseFileId}/evidence-groups/{evidenceGroupId}

1. POST G/large-evidence-uploads
      { "id":<uuid>, "evidenceId":<uuid>, "totalSizeMB", "title", "fileName", "capturedAt":<ISO> }
      → 201, no body                                                      ← NO hash
2. GET  G/large-evidence-uploads/{id}/pending-offsets?count=<n>
      → { "data":[ { "id", "largeEvidenceUploadId", "offset" } ], "meta":{ "totalElements" } }
3. for each pending offset:
      GET G/large-evidence-uploads/{id}/pending-offsets/{offsetId}/upload-url   → { "url" }
      PUT <url>   (that chunk's bytes, with Content-Length — no chunked transfer encoding)
      PUT G/large-evidence-uploads/{id}/pending-offsets/{offsetId}/uploaded     (no body) → 204
4. repeat 2–3 until no offset is pending. After the last chunk the platform completes the file
   and finishes the evidence by itself, asynchronously.
5. wait until GET G/evidences/{evidenceId} returns the evidence, then close the group
   (POST /case-files/{caseFileId}/evidence-groups/{evidenceGroupId}/close, as above).
```

- **`totalSizeMB`**: a number ≥ 1 with up to 6 decimals. Above `maxLargeEvidenceSizeMB` the create is refused (validation error) before anything exists.
- **`offset`** is the chunk index from 0: chunk `offset` starts at byte `offset × chunk size` and is one chunk long (the last one shorter). `pending-offsets` returns the offsets still pending **and creates new ones** up to `count` (a required integer). Whether "MB" means 10⁶ or 2²⁰ bytes is not confirmed: use the same unit for `totalSizeMB` and the chunk length, and the chunks always cover the file — only the comparison with the cap depends on the convention.
- **Only the group's creator can upload.** Pending offsets, upload URLs, marking chunks, cancelling and the close request all require the identity that created the evidence group; the create itself only needs collaborator or higher on the case file, so a non-creator's create succeeds and every chunk call after it is refused. Upload into a group you created.
- **Progress:** `GET G/evidences/{evidenceId}/large-upload` → `{ id, evidenceId, fileName, chunkSizeMB, totalSizeMB, biggestUploadedOffset }`; `GET G/large-evidence-uploads` lists the group's uploads. The platform deletes the upload record when it finishes the evidence, so `large-upload` answers `404` from then on (and after a cancel).
- **Cancel:** `DELETE G/large-evidence-uploads/{id}` — the **upload** id, not the evidence id → `204`. It discards the pending chunks, aborts the file upload and removes the upload. Irreversible. `409` if the evidence is already linked to a dossier; `404` once the platform has finished the evidence.
- **Close request:** `POST G/close-request { "id":<uuid>, "userAgent"? }` → `201` files a request to close the **whole group**. The platform acts on it when a large upload in the group next ends (finishes, is cancelled, or has its evidence deleted), and closes the group if it holds at least one evidence. Use it only while another large upload in the group is still running: with none running it stays pending and closes the group later, unasked. Closing is irreversible. With nothing else running, close with `POST .../close` instead.

> ⚠️ **Do NOT compute or send a sha-256 for the large-file path.** Unlike the simple `upload-url` flow (§2), the multipart path takes **no `hash` and no `x-amz-checksum-sha256`** — the platform computes the sha-256 **server-side, after all chunks are uploaded and the file is recomposed**. You only supply `totalSizeMB` and upload chunks by offset. Prefer the simple upload-url flow for normal-sized files.

### Maintaining evidences and groups

```
E = /case-files/{caseFileId}/evidence-groups

GET    E/{id}                                     → { id, code, name, description, type, status, evidenceStats, createdBy, createdAt, … }
PUT    E/{id}                                     { "name", "description"? }  → 204   (name required, ≤ 64; description ≤ 160)
DELETE E/{id}                                     → 204   discard the group (irreversible)
PUT    E/{evidenceGroupId}/evidences/{id}         { "title"?, "relevant"? }   → 204   (title ≤ 128)
DELETE E/{evidenceGroupId}/evidences/{id}         → 204   logical delete (irreversible)
GET    E/{evidenceGroupId}/evidences/{id}/download-url   → { "downloadFileUrl" }
```

- **Group `status`:** `OPEN` → `CLOSING` → `CLOSED` (sealed).
- **Discarding a group** is refused when it is `CLOSING` or already discarded; when it is `OPEN` and any of its evidences is `COMPLETED`; and when it is `CLOSED` and holds no evidence or any evidence other than capture-metadata records. In practice neither a sealed group with real evidence nor an empty sealed group can be deleted. When it succeeds, its evidences go with it.
- **Deleting an evidence** is allowed only when it is `COMPLETED`, still waiting for its file (`INTERNAL` custody, bytes not uploaded), or a required timestamp ended in `ERROR`; it is refused while the evidence is being processed and when it is under, or entering, qualified archiving.
- **`relevant`:** evidences created through `POST /evidences` or the large-file path start with `relevant: true`. An express dossier (§4) sent without `evidenceIds` links only the group's relevant evidences, and `evidences-to-link` can filter on it — set `relevant: false` to leave an evidence out.
- **`download-url`** requires the evidence to belong to the case file in the path.

*(The discard and delete rules are read from the platform's evidence-manager source, not exercised live.)*

---

## 4. Dossiers (evidence certificates)

A **dossier** ("certificado de evidencia") binds one or more evidences into a certified, timestamped PDF report built from a **template model**, optionally protected by a password and published on a public page. This is the richest workflow in the API.

### Step 0 — check the template is enabled (and read its fields)

A dossier is always built from a template model. Which models exist depends on the deployment and the account:
```
GET /users/{userId}/dossier-models
    → { "data":[ { "id", "index", "certificateLanguages":[…], "translations":[{name,language}] } ], "meta" }
GET /users/{userId}/dossier-models/{modelId}/translation/{language}
    → { "name", "description", "certificateLanguages":[…], "fields":[ { "attribute","type","name","helper","defaultValue" } ] }
```
- If `data` is empty, the account has **no editable template enabled** — dossier creation with a model won't work; get the template enabled first.
- **GoCertius** ships a single standard model (e.g. "Certificado", no fields). **EAD Enterprise** exposes editable models (e.g. "General", and "General con datos del solicitante" which requires `companyName` + `companyTaxId`).
- The `translation/{language}` call is how you discover (a) the languages a model can certify in (`certificateLanguages`) and (b) the **fields the template requires** (`fields[]`). `type` is `SimpleText` or `RichText`. **Not every model has fields** — many return `fields: []`.

### The normal flow

```mermaid
sequenceDiagram
    participant App
    participant API
    App->>API: GET /users/{uid}/dossier-models (+ /translation/{lang})   # pick model, read fields
    App->>API: POST /case-files/{cf}/dossiers (modelId, filledFields, validity, accessToken?)
    App->>API: POST .../dossiers/{d}/case-files-to-link/{cf}/link-evidences (ids:[…])
    App->>API: GET  .../dossiers/{d}/report-preview   # optional HTML sanity check
    App->>API: PUT  .../dossiers/{d}/certify          # DRAFT → CERTIFYING → CERTIFIED
    App->>API: GET  .../dossiers/{d}/document-url / package-url
```

```
1. POST /case-files/{caseFileId}/dossiers
      { "id":<uuid>, "modelId", "name", "language":"es_ES",
        "validityFrom", "validityTo",
        "filledFields": { "<attribute>": "<value>", … },   # required iff the model declares fields
        "accessToken": "<password>",                        # optional public-page password
        "embeddedEvidences": false }                        # optional — see Options & rules
2. GET  .../dossiers/{dossierId}/case-files-to-link/{caseFileId}/evidences-to-link   # candidate COMPLETED evidences (any group status)
   POST .../dossiers/{dossierId}/case-files-to-link/{caseFileId}/link-evidences  { "ids":[ <evidenceId>, … ] }
3. GET  .../dossiers/{dossierId}/report-preview     # OPTIONAL — returns { "reportPreview": "<!DOCTYPE html>…" } to sanity-check before issuing
4. PUT  .../dossiers/{dossierId}/certify            # async → poll GET .../dossiers/{dossierId} until status CERTIFIED, or back to DRAFT = failed (bounded — see §2.3)
5. GET  .../dossiers/{dossierId}/document-url       → { "url" }  the certified PDF
   GET  .../dossiers/{dossierId}/package-url        → { "url" }  full package (PDF + evidence files, ZIP)
```

**Options & rules (tested):**
- **Seal the group first — advised, not required by the API.** `evidences-to-link` returns the `COMPLETED` evidences that are not capture-metadata records, whatever their group's status (an evidence can be `COMPLETED` while its group is still `OPEN`), and also those already linked, flagged `linked`. `link-evidences` checks only that the ids belong to the case file; the `ids` you link are the evidence ids. You can call `link-evidences` multiple times (even across case files — vary `caseFileToLinkId`). *(The group-status and linking rules are read from the platform's source, not exercised live.)*
- **`filledFields`** must supply every field the model declares (`422 { filledFields.<attr>:[isNotEmpty] }` otherwise). Omit entirely for fieldless models.
- **`accessToken`** (the public-page password) is optional but **pattern-validated**: **min 8 chars, and must contain upper + lower + digit** (e.g. `Abcd1234`). Digits-only, letters-only, or missing a class → `422 { accessToken:[matches] / [minLength] }`.
- **`validityFrom`/`validityTo`** define the availability window of the public page.
- **`report-preview`** returns a full HTML document under `reportPreview` — render it to verify layout/fields before the irreversible `certify`. Purely optional.
- **`certify` is async**: `DRAFT → CERTIFYING → CERTIFIED` (~10 s), or back to `DRAFT` if certification fails. Poll per §2.3 (every ~5 s, max ~12 tries); download URLs only work once `CERTIFIED`. `certify` answers `409` when no evidence is linked, when any linked evidence is not `COMPLETED`, or when there are more than the platform's maximum. *(The `409` cases and the return to `DRAFT` are read from the platform's source, not exercised live.)*
- **Edits** (`PUT .../dossiers/{id}`) are allowed only while `DRAFT`.
- **`embeddedEvidences`** (optional, default `false`): `true` embeds the evidence files linked to the dossier as attachments inside the certificate PDF. **GoCertius does not offer evidence embedding:** there, create always stores `false`, whatever is sent — leave the field unset on GoCertius.

### Express (create + certify in one call)

```
POST /case-files/{caseFileId}/evidence-groups/{evidenceGroupId}/dossier-express
     { "id":<uuid>, "modelId"?, "evidenceIds"?:[…], "name", "language" }   → dossier goes straight to CERTIFYING
```
Express skips the link/preview steps. Without `evidenceIds` it links the group's **relevant** evidences — all of them unless you set `relevant: false` on some (§3, *Maintaining evidences and groups*). ⚠️ **It certifies only `COMPLETED` evidences:** any other (still processing, or an id not in the group) is left out **without an error**, and it answers `409` only when no `COMPLETED` evidence remains — wait until every evidence is `COMPLETED` before calling it. ⚠️ **The default template differs by deployment:**
- **GoCertius** — omitting `modelId` uses the built-in **standard** template. Evidence files are never embedded.
- **EAD Enterprise** — there is no standard default: omitting `modelId` returns **`403 Forbidden`**. You must pass a `modelId` of an **editable** template (and its `filledFields` if it declares any). The certificate embeds the evidence files as attachments. `dossier-group-certify` / `.../evidence-groups/{id}/dossier-express` are the express entry points.

### After issuing

Once `CERTIFIED`:
- **Deactivate the public page:** `PUT .../dossiers/{dossierId}/visibility { "visibility":"RECALLED" }` (values: `ACCESSIBLE` · `PENDING_RECALL` · `RECALLED`). Returns `204`.
- **Delete:** `DELETE .../dossiers/{dossierId}` (works in `DRAFT` to discard, or `CERTIFIED` to permanently remove — irreversible). Returns `204`.
- **Share externally:** the public page lives under `/public/dossiers/{dossierId}/…` (the viewer supplies the `accessToken` password).

> ✅ **Tested end-to-end** against EAD Enterprise Suite (2026-07-06): read `dossier-models` + `translation/es_ES` (model "General con datos del solicitante" → fields `companyName`,`companyTaxId`) → create dossier with `filledFields` + `accessToken:"Abcd1234"` (201) → `link-evidences` (201, linked count 1) → `report-preview` (200, `reportPreview` = `<!DOCTYPE html>…`) → `certify` (202) → polled `CERTIFYING → CERTIFIED` → `document-url` PDF (~861 KB) + `package-url` ZIP (~826 KB) → `visibility RECALLED` (204) → `DELETE` (204, then `GET` 404). Express confirmed: fieldless editable model → `201 → CERTIFIED`; no-`modelId` express on EAD → `403`.

---

## 5. E-signature

> **Deployment scope:** E-signature is available on **both** GoCertius and EAD Enterprise Suite (`GET /settings` → `featureFlags.signatures` is on in both production deployments, checked 2026-11).

This is the most stateful workflow. Build the request, attach documents (upload bytes), add people, place signatures, **then** activate. You cannot activate an incomplete request.

```mermaid
sequenceDiagram
    participant App
    participant API
    App->>API: POST /signature-requests (type, sequence, deadline, closeCondition)
    App->>API: POST .../documents (hash, title, fileName) → { url }
    App->>+API: PUT {url} (raw PDF bytes)
    App->>API: GET .../documents (poll until READY_TO_SIGN)
    App->>API: POST .../participants (role=SIGNATORY, name, email)
    App->>API: PUT .../documents/{docId}/signatories/{signatoryId}/coordinates
    App->>API: PUT .../activate
    API-->>App: request ACTIVE — signers notified
```

### Step order
```
1. POST /case-files/{caseFileId}/signature-requests
      { "id":<uuid>, "name", "language":"es_ES", "deadline",
        "signatureType":"ADVANCED", "sequence":"PARALLEL",
        "closeCondition":"ALL_REQUIRED", "dashboardUrl":"NONE", "objectiveId"? }
2. POST .../signature-requests/{requestId}/documents
      { "id", "hash", "title", "fileName", "convertToPdf"?, "fileSize"? }   → { "url" }
3. PUT <url>   (raw PDF bytes)
4. GET  .../signature-requests/{requestId}/documents   ← poll until each document status is READY_TO_SIGN (bounded — see §2.3)
5. POST .../signature-requests/{requestId}/participants
      { "id", "role":"SIGNATORY", "firstName", "lastName", "email",
        "phonePrefix":"+34"?, "phoneNumber"?, "linkToAllDocuments"? }
   (order is free: participants created with `linkToAllDocuments` are linked to documents added before or after them)
6. PUT  .../documents/{documentId}/signatories/{signatoryId}/coordinates   ← {signatoryId} = the participant id you minted
      { "coordinates":[ { "page":1, "x":30, "y":230 } ] }
7. PUT  .../signature-requests/{requestId}/activate
```

### Options
| Choice | Field | Values | Notes |
|---|---|---|---|
| Signature level | `signatureType` | `INTERPOSITION` · `ADVANCED` · `WITH_CERTIFICATE` | `INTERPOSITION` = simple signature by link (also by WhatsApp/SMS on request). `ADVANCED` = the signer confirms with a one-time code to their mobile (phone required). `WITH_CERTIFICATE` = the signer uses their own digital certificate (one position per signatory and document). |
| Signing order | `sequence` | `PARALLEL` · `CONFIGURABLE` | `PARALLEL` = everyone signs at once. `CONFIGURABLE` = ordered/grouped; use `.../groups` and per-signatory sequence. |
| Completion rule | `closeCondition` | `ALL_REQUIRED` · `PARTIAL_ALLOWED` | `ALL_REQUIRED`: it completes when everyone has signed. `PARTIAL_ALLOWED`: it completes once no signature is pending — a rejection does not block the others. |
| Signer dashboard | `dashboardUrl` | `NONE` · `ANONYMIZED` | Whether signers receive an url to a co-signer dashboard. |
| Language | `language` | `en_GB` · `es_ES` | |
| Participant role | `role` | `SIGNATORY` · `OBSERVER` · `VALIDATOR` | Observers get read access; validators approve a signatory before they can sign (`.../signatories/{id}/validators`). |

### `convertToPdf` — only for Word documents

`convertToPdf` (a boolean on the add-document call / the MCP add-document tool) has **one specific job: transform an uploaded Microsoft Word document (`.docx` — the platform refuses it for any other file name) into a PDF** so signatures can be placed on it.

- **Set `convertToPdf: true` *only* when the file you upload is a `.docx`.** The backend converts it to PDF during document processing; the resulting PDF is what gets signed and is downloadable via `GET .../documents/{documentId}/converted-download-url` (the original Word file stays at `.../download-url`).
- **For a PDF you already have (or any non-Word file), leave it `false`/omit it** — no conversion happens; you upload the PDF bytes directly.
- Either way, signature coordinates and `READY_TO_SIGN` apply to the PDF: with `convertToPdf`, wait for the conversion to finish (it's part of the async processing) before setting coordinates and activating.

### Placing signatures

1. **Which documents:** every PDF, and every `.docx` with `convertToPdf`, for every signatory linked to it.
2. **Find the page:** extract the PDF's text page by page and look for the signature block — the signer's
   name, "Firma", "Fdo.", "Signature", or signature lines near the end. Pages count from 1.
3. **Position:** `{ "page", "x", "y" }`, one per signatory per document (`WITH_CERTIFICATE` signatures allow
   exactly one). **Convention (measured live, 2026-11-26):** x and y are PDF points from the page's
   **bottom-left** corner, and `(x, y)` is the bottom-left corner of the signature stamp, which occupies
   x+15..x+104 by y..y+66.5. To sit it on a line starting at (lx, ly): x = lx − 15, y = ly. Keep x ≥ 45 (the
   signed PDF adds a 42-pt band on each page's left edge), x ≤ width − 104, y ≤ height − 67; text extractors
   measure from the top (y = height − y_top). A page the PDF lacks is not refused: a blank page is appended
   and signed.

### Gotchas that will bite you
- **`signatoryId` in the coordinates path is the participant `id` you minted.** The platform resolves that person's per-document signer itself (by email); a participant not linked to the document gets `404 Signatory not found`.
- **Coordinates are required at activation on every PDF** (and every `.docx` sent with `convertToPdf`), for every signatory linked to it, **whatever the signature type**; other files need none. Missing → `409 SignatoriesWithoutCoordinates`. The coordinates call replaces that signatory's positions on that document (safe to repeat). See *Placing signatures* above.
- **Poll for `READY_TO_SIGN`.** Documents are processed async after upload (~30 s for small PDFs). Activating too early fails. Poll per §2.3 (every ~5 s, cap ~12 tries) — don't tight-loop.
- **Deadline ceiling 31 days.** A `deadline` more than 31 days out is rejected. Send an ISO datetime within range.
- **`phonePrefix` needs the `+`** (e.g. `"+34"`, not `"34"`) — otherwise the participant is flagged invalid.
- **`sendWaUrl` / `sendSmsUrl` are only for `INTERPOSITION` and `WITH_CERTIFICATE` signatories with a phone** (SMS only where the platform enables it). On `ADVANCED`, or for observers/validators, the participant call is refused (422 `isInvalid`). An `INTERPOSITION` signatory with a phone gets `sendWaUrl: true` by default.
- **Creating a request is not idempotent.** A second `POST` with the same `id` answers 500 and leaves an orphan request on the platform: check with `GET .../signature-requests/{id}` (404 = safe) before retrying.
- **A document in `ERROR`, or never uploaded, blocks activation with an opaque 504.** A document that never receives its bytes stays `PENDING` forever; `ERROR` follows a failed hash check or a failed registration (then the add-document reply has no `url`). The same `fileName` twice in one request is refused.
- **Document upload uses the same S3 checksum header** as evidence (§2) — `x-amz-checksum-sha256: <base64 sha-256>` on the `PUT`, or `403 SignatureDoesNotMatch`. The document must be a valid PDF for coordinate placement.
- Manage a live request with `.../resend` (remind pending signers), `.../cancel` (stop it) and `.../close` (finish early with what is signed → `COMPLETED_MANUAL`). Fetch outputs — `.../documents/{documentId}/signed-document-url` and `.../documents/{documentId}/certificates/...` — only once the whole request is `COMPLETED` or `COMPLETED_MANUAL` (refused before).

> ✅ **Tested end-to-end** against EAD Enterprise Suite on 2026-07-02, `INTERPOSITION` type: `POST /signature-requests` (201) → `POST .../documents` (201, returns `{url}`) → `PUT` PDF with `x-amz-checksum-sha256` (200) → poll `GET .../documents` until `READY_TO_SIGN` → `POST .../participants` role `SIGNATORY` (201) → read `signatoryId` from `GET .../documents/{doc}/signatories` → `PUT .../signatories/{signatoryId}/coordinates` `{"coordinates":[{"page":1,"x":30,"y":230}]}` (200) → `PUT .../activate` (200). Final request `status: ACTIVE`; the sign link was delivered by email + WhatsApp.

### Retrieving signed outputs (tested)

Once every signer has signed, the request reaches `status: COMPLETED` and each document is `SIGNED`. All output links are `GET`s returning `{ url }` (the file lives on object storage — download with a plain unauthenticated GET):
```
GET .../documents/{documentId}/signed-document-url            → { signedDocumentUrl }  # the signed PDF
GET .../documents/{documentId}/certificates/document-url      → { documentUrl }         # completion certificate (PDF)
GET .../documents/{documentId}/certificates/package-url       → { packageUrl }          # full evidential package (ZIP)
GET .../documents/{documentId}/certificates/signatures-url    → { signaturesUrl }
```
> ✅ Tested 2026-07-03 against a `COMPLETED` request: `signed-document-url` → `application/pdf` (~590 KB); `certificates/document-url` (completion certificate) → `application/pdf` (~893 KB); `certificates/package-url` → ZIP (~1.5 MB). Note the field names differ per endpoint (`signedDocumentUrl`, `documentUrl`, `packageUrl`, `signaturesUrl`). These return an error until the document is actually `SIGNED` — a signed document does not exist while the request is still `ACTIVE`.

---

## 6. Notifications (certified delivery)

Certified delivery of a document/message to one or more receivers, with a delivery certificate.

```
1. POST /case-files/{caseFileId}/notification-requests
      { "id":<uuid>, "subject", "content", "language":"es_ES",
        "type":"RECEIVED_AGREE", "otpByDefault"?, "sendWaUrlByDefault"? }
2. POST .../notification-requests/{id}/receivers
      { "id":<uuid>, "firstName", "lastName", "email",
        "phonePrefix":"+34"?, "phoneNumber"?, "otpRequired"?, "sendWaUrl"? }
      (bulk: POST .../receivers/massive)
3. POST .../notification-requests/{id}/documents
      { "id":<uuid>, "fileName", "hash", "fileSize"? }   → { "url" }
   PUT <url>   (raw bytes)
4. PUT  .../notification-requests/{id}/send      (use /send — /activate is deprecated in the API docs)
5. GET  .../receivers/{receiverId}/certificates  → delivery evidence
```

| Option | Field | Values |
|---|---|---|
| Response mode | `type` | `NO_RESPONSE` · `ACCEPTED_OR_NOT` · `RECEIVED_AGREE` |
| Language | `language` | `en_GB` · `es_ES` |
| Per-receiver OTP | `otpRequired` / `otpByDefault` | boolean |
| WhatsApp link | `sendWaUrl` / `sendWaUrlByDefault` | boolean |
| RCS / SMS link | `sendSmsUrl` / `sendSmsUrlByDefault` | boolean — the channel negotiates: RCS where the recipient's handset supports it, SMS otherwise |

Same UUID + `phonePrefix "+"` rules as signatures apply.

> ⚠️ **`content` MUST be HTML.** Plain text is accepted by the API (the send even reports `SENT`) but **does not render** on the recipient's landing page. Only a small tag set is supported: `<p>`, `<strong>`, `<em>`, `<ul><li>`, `<ol><li>` — no other tags, no CSS. Also keep `subject` to plain ASCII: avoid em dashes and smart quotes (use `-` and straight quotes).

> 📡 **Track delivery via SSE, not polling.** Subscribe to `GET /notifications/sse/{companyId}` (Server-Sent Events; resume after a drop with the `Last-Event-ID` header) to receive status transitions as they happen instead of polling `notification-requests/{id}`. If you have no way to consume SSE, fall back to bounded polling per §2.3 (every ~5 s, cap ~12 tries).

### Tested end-to-end walkthrough (curl)

> ✅ Executed against EAD Enterprise Suite (`https://api-eadcustody.eadtrust.gocertius.io`, same shared API) on 2026-07-02 — real certified delivery to an email + WhatsApp number. Each status is a real response.

```bash
BASE=https://api-eadcustody.eadtrust.gocertius.io   # or https://api-gocertius.gocertius.io
CF=<caseFileId>; NR=$(uuidgen|tr A-Z a-z); RC=$(uuidgen|tr A-Z a-z)
HTML='<p>Hola,</p><p>Prueba de <strong>entrega certificada</strong>.</p><ul><li>Email</li><li>WhatsApp</li></ul>'

# 1) create request (201) — content is HTML
curl -s -X POST "$BASE/case-files/$CF/notification-requests" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"id\":\"$NR\",\"subject\":\"Prueba certificada\",\"content\":\"$HTML\",\"language\":\"es_ES\",\"type\":\"NO_RESPONSE\"}"

# 2) add receiver (201) — email + WhatsApp (sendWaUrl:true, phonePrefix WITH the +)
curl -s -X POST "$BASE/case-files/$CF/notification-requests/$NR/receivers" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"id\":\"$RC\",\"firstName\":\"Hugo\",\"lastName\":\"Alonso\",\"email\":\"user@example.com\",\"phonePrefix\":\"+34\",\"phoneNumber\":\"600000000\",\"sendWaUrl\":true,\"otpRequired\":false}"

# 3) send (200)
curl -s -X PUT "$BASE/case-files/$CF/notification-requests/$NR/send" -H "Authorization: Bearer $JWT"

# 4) verify (status → "SENT", sentAt populated) — prefer the SSE stream over re-polling this
curl -s "$BASE/case-files/$CF/notification-requests/$NR" -H "Authorization: Bearer $JWT" | jq '{status, sentAt}'
```
(Attaching a document — step 3 in the sequence above — is optional; the receiver + `sendWaUrl` are what drive email/WhatsApp delivery.)

> ⚠️ **Attachment ordering (tested).** If you attach a document, you must **add the document *before* the receivers** and **wait until its status is `READY_TO_SEND`** before calling `/send`. Attaching after receivers, or sending while the document is still `PENDING`, fails with `409/404 NOTIFICATION_NOT_FOUND`. Notification documents use the same `hash → {url} → PUT + x-amz-checksum-sha256` upload as everything else. Poll `GET .../notification-requests/{id}/documents` (status `PENDING → READY_TO_SEND`, ~8 s) with bounded retries per §2.3.

> ⚠️ **Lifecycle constraints (tested 2026-09-04/05, production).** Four things the spec does not say:
> **(1)** `PUT .../notification-requests/{id}` and `DELETE .../notification-requests/{id}` return
> **403 Forbidden once the request has been SENT** — they work only before the send.
> **(2)** A receiver whose `status` is `INVALID` **blocks `/send`**; clear them with
> `DELETE .../invalid-receivers` or fix the address with `PUT .../receivers/{id}` first.
> **(3)** `POST .../notification-requests/{id}/duplicate` is **asynchronous** and copies the
> content, the receivers **and** the documents: the copy appears in `CREATING` with zero of both and
> fills in after a few seconds, so polling it immediately shows an empty request that is not empty.
> It honours the `id` you supply.
> **(4)** `POST .../receivers/{receiverId}/duplicate` returned **HTTP 500 on every call shape tried**
> (same request as source and target, across two requests, and a receiver id from a sent request).
> Add the receiver again with `POST .../receivers` instead.

### Delivery certificates (tested)

Each receiver gets a certificate proving delivery/read. Generate it after the request is `SENT` (or a later read/answer state), then download:
```
POST /case-files/{cf}/notification-requests/{nr}/receivers/{rc}/certificates   { "id":<uuid>, "language":"es_ES" }   (201)
GET  .../certificates/{certId}/document-url   → { "url" }   # the certificate PDF  ("sin anexos")
GET  .../certificates/{certId}/package-url    → { "url" }   # ZIP: certificate + annex previews  ("con anexos")
```
> ✅ Tested 2026-07-02/03: `document-url` returns the certificate as `application/pdf`; `package-url` returns a ZIP that **bundles the notification's attachments** — this is the "with vs without attachment preview" distinction (there is no separate preview flag; the *package* carries the annexes, the *document* is the certificate alone). Certificate generation is async — the first `document-url` call may 404/return empty; poll a few times per §2.3 (don't hammer). Notification status vocabulary: `CREATING → DRAFT → IN_PROCESS → SENT → PARTIALLY_READ → FULLY_READ → PARTIALLY_ANSWERED → FULLY_ANSWERED`; don't request a certificate before `SENT`.

---

## 7. Chats (certified conversations)

> **Deployment scope:** Chats are **GoCertius only** — this product is not enabled on EAD Enterprise Suite.

A **chat** captures a conversation (Telegram-backed) under a case file and lets you emit a certified PDF of a message range.

```
1. POST /case-files/{cf}/chats
      { "id":<uuid>, "title", "service":"Telegram", "language":"es_ES", "serviceTitle"?, "serviceDescription"? }   (201)
2. GET  /case-files/{cf}/chats/{chatId}/invitation-url     # link to invite participants (available once the Telegram channel is provisioned)
3. …participants join and exchange messages (GET .../messages, GET .../participants)…
4. POST /case-files/{cf}/chats/{chatId}/certificates
      { "id":<uuid>, "modelId", "name", "language":"es_ES",
        "validityFrom", "validityTo", "chatMessagesFrom", "chatMessagesTo" }   (201)
5. PUT  .../chats/{chatId}/certificates/{certId}/certify    (202)
6. GET  .../chats/{chatId}/certificates/{certId}/document-url   → { "url" }   # certificate PDF
   GET  .../chats/{chatId}/certificates/{certId}/package-url    → { "url" }   # full package (ZIP)
```
- `modelId` comes from `GET /users/{userId}/chat-certificate-models`.
- `service` currently only accepts `Telegram`.
- ⚠️ **`chatMessagesFrom` must be ≥ the chat's `registeredAt`** (you can't request messages from before the chat existed) — otherwise `422 { chatMessagesFrom:[lessThan registeredAt] }` — and before `chatMessagesTo`. Read `registeredAt` from `GET .../chats/{chatId}` and use it as the range start.
- ⚠️ **A future `chatMessagesTo` is not refused:** the platform silently caps it to the current time, so messages written later are not covered. Certify a range that has already ended.
- After `certify`, poll `document-url`/the certificate status until `CERTIFIED` per §2.3 (every ~5 s, cap ~12 tries). Status: `DRAFT → CERTIFYING → CERTIFIED`, or back to `DRAFT` if certification fails.

> ✅ **Tested end-to-end** (GoCertius, 2026-07-03): create chat (201) → create certificate with `chatMessagesFrom = registeredAt` (201) → `certify` (202) → poll `document-url` (ready in ~8 s, `status: CERTIFIED`) → downloaded the certificate PDF (`application/pdf`, ~2 MB) and the package ZIP (~2 MB). `invitation-url` returns `404 "Chat not found"` until the Telegram channel is provisioned — retry once the chat has participants.

### Finding an existing chat, its messages and participants

To certify a conversation that already exists, list instead of creating (chats live in the personal case file — `GET /profile` → `defaultCaseFileId`, §1):
```
GET /case-files/{cf}/chats?filter[search]=…&filter[status]=active&order[createdAt]=DESC&page[number]=1&page[size]=20
    → { "data":[ { id, code, status, service, title, createdAt, owner, createdBy } ], "meta":{ totalElements } }
GET /case-files/{cf}/chats/{chatId}/messages?filter[writtenFrom]=<ISO>&filter[writtenTo]=<ISO>&order[writtenAt]=ASC&page[number]=1&page[size]=100
    → { "data":[ { id, writtenBy, writtenAt, deleted, contentHistory, reactions, replyTo, reactTo } ], "meta" }
GET /case-files/{cf}/chats/{chatId}/participants?filter[id]=…&page[number]=1&page[size]=20
    → { "data":[ { id, userName, firstName, lastName, participationHistory } ], "meta" }
```
- Chat filters: `search` (free text), `service` (`Telegram`), `status`, `createdFrom` / `createdUntil` (creation-date range, ISO 8601), `id`. Order by `title` or `createdAt` (`ASC` or `DESC`). `page[size]` goes up to 100 (default 20) on all three.
- Chat `status`: `creating` — just created, waiting for the messaging platform to confirm it; until then its messages, participants, invitation URL and certificates answer `404`. `active` — confirmed and usable. `inactive` — in the enum, but not set by the current platform version.
- Pick the message range from `messages`, then create the certificate (step 4) for it, keeping the `registeredAt` rule above.

---

## 8. Quick reference

**Base paths:** all business resources are nested under `/case-files/{caseFileId}/...`. Public (unauthenticated, share-link) reads live under `/public/...`.

**Auth (§1):** **User key (recommended):** `POST /user-keys/session` `{key}` → `{jwt}` (~24 h) — the key goes in the **body of the exchange**, never as a Bearer. **Password:** `POST /session` (email+password, ~1 h). Always `Authorization: Bearer <jwt>` afterwards. **Get your `userId` from `GET /profile` → `id`** (works on any flow; don't trust `payload.sub` on a user-key session); `payload.exp` drives refresh. Key lifecycle: `POST /user-keys` (secret shown once) · `GET /user-keys` (masked) · `DELETE /user-keys/{userKeyId}`. OpenId accounts can't authenticate via this API.

**Global patterns:** client UUID for idempotency · hash → upload-url → PUT bytes for files · build-then-activate for signature & notification requests · **async everywhere → prefer SSE, otherwise bounded polling (≥5 s interval, ~12 attempts max, then stop)**.

**Async / polling discipline (§2.3):** never poll faster than ~5 s or in a tight loop; cap total attempts (~60 s) and surface a timeout rather than hammering; subscribe to `GET /notifications/sse/{companyId}` (with `Last-Event-ID`) for notification events instead of polling.

**Outputs:** downloadable artefacts (signed docs, certificates, packages) are always a `GET …-url` returning `{ url }` to unauthenticated object storage — `document-url`/`signed-document-url` = a PDF, `package-url` = a ZIP bundling annexes. Certificate generation is async; poll the `-url` endpoint until it returns (bounded).

**Enum cheat-sheet:**
- Case file status: `OPEN` `CLOSED`
- Evidence type: `FILE` `PHOTO` `VIDEO` `WEB_PLUGIN` · Custody: `INTERNAL` `EXTERNAL` · Evidence group status: `OPEN` `CLOSING` `CLOSED`
- Dossier status: `DRAFT` `CERTIFYING` `CERTIFIED` (back to `DRAFT` if certification fails) · visibility: `ACCESSIBLE` `PENDING_RECALL` `RECALLED` · field type: `SimpleText` `RichText` · password `accessToken`: ≥8 chars, upper+lower+digit
- Signature type: `INTERPOSITION` `ADVANCED` `WITH_CERTIFICATE` · Sequence: `PARALLEL` `CONFIGURABLE` · Close: `ALL_REQUIRED` `PARTIAL_ALLOWED` · Role: `SIGNATORY` `OBSERVER` `VALIDATOR` · Request status: `CREATING` `DRAFT` `ACTIVE` `PARTIALLY_SIGNED` `FULLY_SIGNED` `CANCELLED` `COMPLETED` `REJECTED` `CLOSING` `COMPLETED_MANUAL` (doc: `PENDING` `READY_TO_SIGN` `PARTIALLY_SIGNED` `SIGNED` `REJECTED` `ERROR`) · deadline ≤ 31 days
- Notification type: `NO_RESPONSE` `ACCEPTED_OR_NOT` `RECEIVED_AGREE` · status: `CREATING` `DRAFT` `IN_PROCESS` `SENT` `PARTIALLY_READ` `FULLY_READ` `PARTIALLY_ANSWERED` `FULLY_ANSWERED` · doc: `PENDING` `READY_TO_SEND` · send via `/send` (`/activate` deprecated)
- Chat service: `Telegram` · chat status: `creating` `active` `inactive` · chat certificate status: `DRAFT` `CERTIFYING` `CERTIFIED` (back to `DRAFT` if certification fails)
- Languages: `en_GB` `es_ES` (`pt_PT` for dossiers)


---

## Changelog

- **1.1.0 — 2026-11-26.** **E-signature is on both deployments** — the product table and its paragraph now say so. This entry also records the §5 changes made earlier in this release: `WITH_CERTIFICATE`, the coordinates path takes the participant id, coordinates required on every PDF whatever the signature type, the stamp-placement convention, and new gotchas. **Corrected:** §2 lists case files with `GET /users/{userId}/case-files` instead of `GET /case-files`. Sealing a group is advised but **not required** before linking or certifying: `evidences-to-link` returns `COMPLETED` evidences whatever their group's status, and linking checks only that the ids belong to the case file (§4). The express dossier certifies only `COMPLETED` evidences, leaves any other out without an error and answers `409` only when none remains; it embeds the evidence files on EAD Enterprise Suite and never on GoCertius (§4). `certify` answers `409` with no linked evidence, a linked evidence not `COMPLETED`, or more than the platform's maximum, and a failed certification returns dossiers and chat certificates to `DRAFT` (§4, §7, §8). The chat range: `chatMessagesFrom` before `chatMessagesTo`, and a future `chatMessagesTo` capped to the current time, not refused (§7). Added: **case-file update** and what a `CLOSED` case file refuses (§2); the **large-file resumable upload** as a full flow — EAD Enterprise Suite only, with `GET /settings` limits, the creator-only rule, progress, cancel and the group close request (§3); **evidence and evidence-group maintenance** — read, update, discard/delete with their refusal rules, download URL, and `relevant` with its effect on the express dossier (§3, §4); **`embeddedEvidences`** on dossier create/update, per deployment (§4); **listing chats, messages and participants** with the chat status values (§7); fuller status enums (§8). Sources: the 2026-11-23 production OpenAPI and the platform's source. The stamp-placement convention (§5) was measured live on 2026-11-26; the other additions and corrections of this pass are not live-tested. *(Context: Epic E22 in the MCP generator.)*
- **1.0.1 — 2026-09-04.** Annotation only; **no REST-API fact changed and no password content removed**. Records that the GoCertius / EAD Enterprise Suite **MCP servers and n8n node** stopped accepting email/password (and pre-seeded JWTs) and now take `MCP_AUTH_USER_KEY` only, while `POST /session`, the legal-texts 409 gate and `/session-with-legal-texts` remain fully supported by the API — and remain the way a user key is minted. *(Context: Epic E18 in the MCP generator, 2026-09-03. This skill documents the underlying REST API and is versioned independently of the MCP packages.)*
- **1.0.0 — 2026-07-18.** First versioned/dated release. Authentication reworked: **user keys are now the recommended, predominant flow** (production rollout in progress) with password login kept as a fully supported alternative. Added **`GET /profile`** as the canonical way to resolve your `userId` (its `id`) on any flow — and corrected the previous guidance that read `userId` from the JWT `sub` claim, which is unreliable for user-key sessions. **Removed all OpenID access instructions** (device-code / `POST /openid/session` how-to); OpenID now appears only as a two-line note that such accounts cannot authenticate via this API. *(Context: user-key auth shipped in the MCP packages GoCertius v1.5.0 / EAD Enterprise Suite v1.6.0; this skill documents the underlying REST API and is versioned independently.)*
