# Evidence Lifecycle

Create and certify evidence in GoCertius. Evidence is always grouped: you create a group, add N evidences to it, then seal the group. Sealing is mandatory — an unsealed group stays in "capturing" state and is never certified.

## Hierarchy

```
Case File
  └─ Evidence Group  (container; sealed once = certified)
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

4. **Seal the group** — **mandatory step**
   - `evidence_seal` with the group UUID as `id`, `caseFileId`, and `evidencesCount` = exact number of evidences added
   - Returns immediately — the group transitions asynchronously OPEN → CLOSING → CLOSED

   **Completion detection:**

   | Runtime | Approach |
   |---|---|
   | Claude Code / n8n (standard `callTool`) | Poll `evidence_group_list` until `status: CLOSED` |
   | Task-capable MCP client (experimental task streaming) | Server pushes completion via SSE when group closes — no polling needed |

5. **Verify**
   - `evidence_group_list` with `caseFileId` — confirm group `status: "CLOSED"` and `evidenceStats.completed` equals the expected count

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
| Skip `evidence_seal` | Group stays OPEN ("capturing") forever | Always seal after adding all evidences |
| Wrong `evidencesCount` | Seal may fail or certify wrong count | Count exactly how many `evidence_create` calls were made |
| Hash wrong length (≠ 64 hex chars) | `EvidenceCreateError` | Use SHA-256, not MD5 or SHA-1 |
| Use email as `userId` in `case_file_list` | 403 Forbidden | Call `session_info` first to get the UUID |
