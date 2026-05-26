# Dossier Lifecycle

Create certified dossiers (tamper-evident PDFs) that bundle one or more evidence items from a case file.

## Two creation modes

| Mode | Tool | Evidences | When to use |
|---|---|---|---|
| **Express** | `dossier_group_certify` | All from ONE evidence group | Single group, one step |
| **Full** | `dossier_create` → `dossier_evidence_link` → `dossier_certify` | Any subset from any groups | Multiple groups or specific evidence selection |

## Full flow (multi-group)

1. **Create a DRAFT dossier**
   - `dossier_create` with a generated UUID `id`, `caseFileId`, `name`, `language`, `validityFrom`, `validityTo`
   - The dossier starts in `DRAFT` status with 0 evidences

2. **Link evidences**
   - `dossier_evidence_link` with `caseFileId`, `dossierId`, `caseFileToLinkId` (same as `caseFileId` when evidences are in the same case file), and `ids` (array of evidence UUIDs)
   - Can be called once with all evidence IDs, or multiple times for different batches
   - Only COMPLETED evidences from sealed groups can be linked

3. **Certify**
   - `dossier_certify` with `caseFileId` and `dossierId`
   - Dossier transitions `DRAFT` → `CERTIFYING` → `CERTIFIED`
   - Certification is asynchronous; verify with `dossier_list`

## Express flow (single group)

```
dossier_group_certify  id=<uuid>  caseFileId=<id>  evidenceGroupId=<group-id>
  name="..."  language=es_ES
  [evidenceIds=["uuid1","uuid2"]]   ← optional: filter specific evidences within the group
```

The express endpoint creates AND certifies in one call. Do NOT call it in parallel with the same `id` — the first call creates and certifies immediately, subsequent calls fail.

## Example — all evidences across multiple groups

```
dossier_create
  id=<uuid>  caseFileId=<cf-id>  name="Expediente completo"
  language=es_ES  validityFrom=2026-05-20  validityTo=2027-05-20

dossier_evidence_link
  caseFileId=<cf-id>  dossierId=<uuid>  caseFileToLinkId=<cf-id>
  ids=["ev-1","ev-2","ev-3","ev-4","ev-5","ev-6"]

dossier_certify
  caseFileId=<cf-id>  dossierId=<uuid>

dossier_list  caseFileId=<cf-id>   → expect status=CERTIFYING then CERTIFIED
              evidenceGroupsCount=5  evidencesCount=6
```

## Getting evidence IDs

Use `evidence_list` with `caseFileId` + `evidenceGroupId` to get IDs per group, then collect them all before calling `dossier_evidence_link`.

## After certification

Once status is `CERTIFIED`, these operations are available:

| Action | Tool | Notes |
|---|---|---|
| Download PDF | `dossier_document_url` | Returns a presigned URL for the certified PDF |
| Download ZIP | `dossier_package_url` | Returns a presigned URL for ZIP (PDF + evidence files) |
| Manage visibility | `dossier_visibility` | Toggle public access to the certificate |
| Delete certificate | `dossier_delete` | Permanent — cannot be undone |

## Linked evidence management

After linking, inspect or remove linked evidences:

- `dossier_evidence_list` — list all evidences linked to the dossier
- `dossier_evidence_get` — get details of a specific linked evidence
- `dossier_evidence_delete` — unlink a specific evidence (only in `DRAFT`)
- `dossier_evidence_list_to_link` — browse evidences eligible for linking

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Call `dossier_certify` without linking evidences first | `Unknow` error | Always call `dossier_evidence_link` before `dossier_certify` |
| Call `dossier_group_certify` in parallel with same `id` | Race condition — first certifies, rest fail | Use express only once per dossier; use full flow for multiple groups |
| Missing `caseFileId` in `dossier_certify` or `dossier_evidence_link` | Empty network error | Both require `caseFileId` — always pass it explicitly |
| Link evidences from unsealed groups | API error | Only COMPLETED evidences (from CLOSED groups) can be linked |
| Update dossier after certifying | Error | `dossier_update` only works in `DRAFT` |
