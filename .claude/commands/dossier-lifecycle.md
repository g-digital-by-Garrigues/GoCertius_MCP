# Dossier Lifecycle

Create certified dossiers — a certificate (PDF) that bundles one or more evidence items from a case file.

## Two creation modes

| Mode | Tool | Evidences | When to use |
|---|---|---|---|
| **Express** | `dossier_group_certify` | All from ONE evidence group | Single group, one step |
| **Full** | `dossier_create` → `dossier_evidence_link` → `dossier_certify` | Any subset from any groups | Multiple groups or specific evidence selection |

## Full flow (multi-group)

0. **Select a template (optional)**
   - `dossier_template_list` — returns available templates with their IDs and translations
   - Pass the returned `id` as `dossierTemplateId` in `dossier_create` if you need a specific template

1. **Create a DRAFT dossier**
   - `dossier_create` with a generated UUID `id`, `caseFileId`, `name`, `language`, `validityFrom`, `validityTo`
   - The dossier starts in `DRAFT` status with 0 evidences
   - Leave `embeddedEvidences` unset (see "Embedding the evidence files" below)

2. **Link evidences**
   - `dossier_evidence_link` with `caseFileId`, `dossierId`, `caseFileToLinkId` (same as `caseFileId` when evidences are in the same case file), and `ids` (array of evidence UUIDs)
   - Can be called once with all evidence IDs, or multiple times for different batches
   - Linking checks only that the ids belong to the case file. The group does not have to be sealed (an evidence can be `COMPLETED` while its group is still `OPEN`), but sealing it first is advised

3. **Certify**
   - `dossier_certify` with `caseFileId` and `dossierId`
   - Answers 409 when no evidence is linked, when any linked evidence is not `COMPLETED`, or when there are more than the platform's maximum
   - Dossier transitions `DRAFT` → `CERTIFYING` → `CERTIFIED`, or back to `DRAFT` if certification fails
   - Certification is asynchronous; poll `dossier_list` until `status: CERTIFIED` (back at `DRAFT` = it failed)
   - Note: `dossier_certify` has no SSE bridge — always poll regardless of runtime

## Express flow (single group)

```
dossier_group_certify  id=<uuid>  caseFileId=<id>  evidenceGroupId=<group-id>
  name="..."  language=es_ES
  [evidenceIds=["uuid1","uuid2"]]   ← optional: filter specific evidences within the group
```

The express endpoint creates AND certifies in one call. Do NOT call it in parallel with the same `id` — the first call creates and certifies immediately, subsequent calls fail.

**It certifies only `COMPLETED` evidences.** Any other — still processing, or an id not in the group — is left out **without an error**; it answers 409 only when no `COMPLETED` evidence remains. Wait until every evidence is `COMPLETED` (`evidence_get` / `evidence_list`) before calling it.

**Without `evidenceIds` it certifies only the group's relevant evidences.** Evidences created through the API start with `relevant: true`, so by default that is the whole group. To leave one out, set `relevant: false` on it with `evidence_update`, or pass `evidenceIds` (see `/evidence-lifecycle`, "Maintain evidences and groups").

## Embedding the evidence files (`embeddedEvidences`)

`dossier_create` and `dossier_update` take an optional `embeddedEvidences`. `true` embeds the evidence files linked to the dossier as attachments inside the dossier certificate PDF; `false`, the default, does not. **GoCertius does not offer evidence embedding:** on this deployment `dossier_create` always stores `false`, whatever is sent. Leave this field unset on GoCertius.

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

dossier_list  caseFileId=<cf-id>   → expect status=CERTIFYING then CERTIFIED (DRAFT again = failed)
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
- `dossier_evidence_list_to_link` — browse the `COMPLETED` evidences you can link, whatever their group's status; already-linked ones come back flagged `linked` (can filter on `relevant`)

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Call `dossier_certify` without linking evidences first | 409 | Always call `dossier_evidence_link` before `dossier_certify` |
| Call `dossier_group_certify` in parallel with same `id` | Race condition — first certifies, rest fail | Use express only once per dossier; use full flow for multiple groups |
| Missing `caseFileId` in `dossier_certify` or `dossier_evidence_link` | Empty network error | Both require `caseFileId` — always pass it explicitly |
| Link evidences from an unsealed group | Allowed — linking checks only that the ids belong to the case file | Sealing the group first is advised; `dossier_certify` still needs every linked evidence `COMPLETED` (409 otherwise) |
| `dossier_group_certify` while an evidence is still processing | That evidence is left out, without an error | Wait until every evidence is `COMPLETED` (`evidence_get` / `evidence_list`) |
| Update dossier after certifying | Error | `dossier_update` only works in `DRAFT` |
