# Evidence Lifecycle

Create and certify evidence in GoCertius. Evidence is always grouped: you create a group, add N evidences to it, then seal the group. Sealing closes the group (OPEN → CLOSING → CLOSED). The API does not require it before you link the group's evidences to a dossier or certify them, but it is advised. The certificate itself is a dossier (`/dossier-lifecycle`).

## Hierarchy

```
Case File
  └─ Evidence Group  (container; sealing closes it)
       └─ Evidence   (one file per evidence item)
```

## Required inputs

- `case_file_id` — UUID of the target case file (call `session_info` → `case_file_list` if unknown)
- `use_case_id` — UUID of the use case; reuse the one from an existing case file in the same account
- One or more files to certify: for each file you need its `fileName`, a human `title`, and the **SHA-256 hash** of the file content

## Flow

1. **Locate or create a case file**
   - `session_info` → get `userId`
   - `case_file_list` with `userId` to find an existing case file
   - Or `case_file_create` if none exists (requires `id` UUID, `name`, `description`, `useCaseId`)

2. **Create an evidence group**
   - `evidence_group_create` with a generated UUID `id`, `name`, `evidenceType: "FILE"`, and `caseFileId`
   - Note the group UUID — needed for every evidence and the final seal

3. **Add evidence items** (one call per file)

   Choose custody type based on who stores the file:

   **EXTERNAL** — you hold the file, GoCertius records the hash as proof of existence:
   - `evidence_create` with `custodyType: "EXTERNAL"`, `id`, `title`, `fileName`, `hash` (SHA-256 hex, 64 chars), `evidenceGroupId`, `caseFileId`
   - The API may return a network error even when the evidence was persisted — verify with `evidence_list` if in doubt

   **INTERNAL** — GoCertius stores the file in S3, allowing the platform to verify the hash directly:
   - **Easiest path — `evidence_upload`**: pass the local file (`filePath` in stdio mode, or `contentBase64`) plus `caseFileId`, `evidenceGroupId`, `title`, `fileName`. It computes the SHA-256, registers the evidence, and uploads the bytes in one call — no manual hashing or PUT. Use this when the file is on the local machine.
   - **Manual path — `evidence_create`** with `custodyType: "INTERNAL"`, same fields plus `hash`:
   - Response contains `{ uploadFileUrl, expiration }` — a pre-signed S3 URL (valid ~10 min)
   - Upload the file: `PUT <uploadFileUrl>` with headers:
     - `Content-Type: <mime-type>`
     - `x-amz-checksum-sha256: <sha256-base64>` (SHA-256 of the file content, **base64-encoded**, not hex)
   - A 200 from S3 confirms the upload; GoCertius processes it asynchronously
   - Or pass `fileUrl` (public HTTPS, no redirect, <1 GiB) to `evidence_create` to have it download+upload automatically
   - Computing the base64 checksum: `openssl dgst -sha256 -binary <file> | base64`

   Repeat for each file in the group.

4. **Seal the group** — advised (the API does not require it before linking or certifying)
   - `evidence_seal` with the group UUID as `id`, `caseFileId`, and `evidencesCount` = the number of evidences in the group (count them with `evidence_list`)
   - Returns immediately — the group transitions asynchronously OPEN → CLOSING → CLOSED

   **Completion detection:** every client polls — `evidence_group_list` until `status: CLOSED`.

5. **Verify**
   - `evidence_group_list` with `caseFileId` — confirm group `status: "CLOSED"` and `evidenceStats.completed` equals the expected count

## The case file must be OPEN

While a case file is `CLOSED`, `evidence_group_create`, `evidence_create` and `evidence_upload` are refused (409 `CaseFileStatusNotOpen`). Reopen it with `case_file_update` `status: "OPEN"` (needs the editor role or higher on the case file; the user's personal case file cannot be updated). `case_file_update` returns no body — confirm with `case_file_get`.

## Maintain evidences and groups

Every tool takes `caseFileId`. Group tools take the group's id as `id`; evidence tools take `evidenceGroupId` and the evidence's id as `id`. Updates and deletes return no body — confirm with `evidence_group_get` / `evidence_get`.

| Tool | Does | Rules |
|---|---|---|
| `evidence_group_get` | Reads one group: `status` (`OPEN`, `CLOSING`, `CLOSED`), `evidenceStats`, `createdBy` | Use it to check whether a group is sealed before linking it or deleting it |
| `evidence_group_update` | Renames the group or changes its `description` | `name` is required even when unchanged |
| `evidence_group_delete` | Discards the group; its evidences go with it. **Irreversible** | Refused when the group is `CLOSING` or already discarded, `OPEN` with any `COMPLETED` evidence, or `CLOSED` with no evidence or any evidence other than capture-metadata records: in practice neither a sealed group with real evidence nor an empty sealed group can be deleted |
| `evidence_update` | Changes `title`, or sets `relevant` (below) | Both fields optional |
| `evidence_delete` | Deletes one evidence (logical delete). **Irreversible** | Allowed only when the evidence is `COMPLETED`, still waiting for its file (INTERNAL, bytes not uploaded), or a required timestamp ended in `ERROR`; refused while it is processing and when it is under, or entering, qualified archiving |
| `evidence_download_url` | Returns `downloadFileUrl`, the evidence's file | The evidence must belong to that case file |

**`relevant`.** Evidences created through the API (`evidence_create`, `evidence_upload`) start with `relevant: true`. `dossier_group_certify` called without `evidenceIds` certifies only the group's relevant evidences — by default, all of them. To leave one out of an express dossier, set `relevant: false` with `evidence_update` (or pass `evidenceIds`). `dossier_evidence_list_to_link` can filter on `relevant`.

## Computing SHA-256

```bash
# macOS / Linux
shasum -a 256 myfile.pdf | awk '{print $1}'

# Node.js
import { createHash } from "crypto";
import { readFileSync } from "fs";
const hash = createHash("sha256").update(readFileSync("myfile.pdf")).digest("hex");
```

## Example — two files in one group

"Certify test.json and logo.png as evidence for case file 2d46d915-..."

```
evidence_group_create  id=<uuid-group>  name="Documents"  evidenceType=FILE  caseFileId=<cf-id>
evidence_create        id=<uuid-1>      title="test.json"  fileName="test.json"   hash=<sha256>  evidenceGroupId=<uuid-group>  caseFileId=<cf-id>  custodyType=EXTERNAL
evidence_create        id=<uuid-2>      title="logo.png"   fileName="logo.png"    hash=<sha256>  evidenceGroupId=<uuid-group>  caseFileId=<cf-id>  custodyType=EXTERNAL
evidence_seal          id=<uuid-group>  caseFileId=<cf-id>  evidencesCount=2
evidence_group_list    caseFileId=<cf-id>   → expect status=CLOSED, completed=2
```

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Skip `evidence_seal` | Group stays OPEN | Seal after adding all evidences — not required by the API before linking or certifying, but advised |
| Wrong `evidencesCount` | Seal may fail | Count the group's evidences with `evidence_list`, not the `evidence_create` calls (evidences may come from `evidence_upload`, or have been deleted) |
| Hash wrong length (≠ 64 hex chars) | `EvidenceCreateError` | Use SHA-256, not MD5 or SHA-1 |
| Use email as `userId` in `case_file_list` | 403 Forbidden | Call `session_info` first to get the UUID |
| Add a group or evidence to a `CLOSED` case file | 409 `CaseFileStatusNotOpen` | `case_file_update` `status: "OPEN"` first |
