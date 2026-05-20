# Evidence Lifecycle

Create and manage certified evidence chains in GoCertius.

## Parameters

- `case_file_id` (required): UUID of the case file to attach evidence to
- `evidence_group_name` (optional): Name for the evidence group; defaults to "Evidence Group"
- `file_path` (optional): Local path to the file to upload as evidence
- `title` (required): Human-readable title for the evidence item

## Flow

1. **List or create a case file** — use `case_file_list` to find an existing one or create via the GoCertius web interface. Note the `case_file_id`.

2. **Create an evidence group** — call `evidence_group_create` with the case file ID. An evidence group is a container that can be sealed (certified) once all documents are uploaded.

3. **Create evidence** — call `evidence_create` with the group ID and file metadata. For large files, use `large_evidence_upload_initiate` first to get an upload URL, then upload the file via PUT, then confirm with `large_evidence_upload_complete`.

4. **Verify** — call `evidence_get` to confirm the evidence was recorded correctly.

5. **Seal the group** — when all evidence is uploaded, call `evidence_seal` to close and certify the evidence group. This is a long-running operation (pollable). Monitor progress via the task ID returned.

6. **Check seal result** — use `evidence_group_list` to confirm the group status is `sealed`.

## Example

"Upload the contract PDF as certified evidence for case file abc-123 and seal it."

Tool sequence: `case_file_get` → `evidence_group_create` → `evidence_create` → `evidence_seal`
