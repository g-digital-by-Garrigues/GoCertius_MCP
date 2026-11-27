# Agent Prompts — GoCertius MCP Server

End-to-end prompt examples with their expected tool sequences. Use these as starting points or copy them directly into Claude.

For step-by-step guided workflows, use the bundled slash-commands:
- `/evidence-lifecycle` — evidence creation + seal + certificate
- `/dossier-lifecycle` — dossier workflow from template selection
- `/notification-lifecycle` — certified notification from creation to delivery certificate
- `/chat-lifecycle` — certified chat setup and transcript certificate
- `/signature-lifecycle` — signature request, one call or step by step, to the signed document and certificate

---

## Prompt 1: Certify a document as evidence

**User goal:** Register a document as certified evidence and obtain its certificate.

**Prompt:**
```
I need to certify the contract at /Documents/contrato-servicio.pdf as evidence.
Create an evidence group called "Contrato Q1 2026", add the document, seal the group
and give me its certificate. Use case file <caseFileId>.
```

**Expected tool sequence:**
1. `evidence_group_create` — creates the group "Contrato Q1 2026"
2. `evidence_upload` — registers the PDF as an evidence and uploads its bytes (the hash is computed for you)
3. `evidence_get` — until the evidence is `COMPLETED` (`dossier_group_certify` leaves out, without an error, any evidence that is not)
4. `evidence_seal` — `evidencesCount: 1`; returns immediately, then poll `evidence_group_list` until the group is `CLOSED`
5. `dossier_group_certify` — creates and certifies the group's certificate (a dossier; GoCertius uses its standard template when no `modelId` is given); poll `dossier_get` until `CERTIFIED`
6. `dossier_document_url` — the certificate PDF

**Sample agent response:**
> The contract is registered as evidence `<evidenceId>` in the sealed group "Contrato Q1 2026". Its certificate (dossier `<dossierId>`) is CERTIFIED; here is the download link: `<url>`.

---

## Prompt 2: Send a certified notification to multiple recipients

**User goal:** Send a legally valid notification with proof of delivery to a list of email recipients.

**Prompt:**
```
Send a certified notification to juan@empresa.com and maria@empresa.com with subject
"Aviso contractual" and body "Su contrato vence el 31/12/2026. Por favor renuévelo antes
de esa fecha." I need the delivery certificate once they've been notified.
```

**Expected tool sequence:**
1. `notification_request_create` — creates the request (stays `DRAFT`); the body goes in as HTML (`<p>…</p>`)
2. `notification_receiver_add` × 2 — adds each recipient
3. `notification_receiver_list` — checks no recipient is `INVALID` (an `INVALID` recipient blocks the send)
4. `notification_request_send` — dispatches to all receivers
5. `notification_request_status` — until `SENT` (later states: `PARTIALLY_READ`, `FULLY_READ`, `PARTIALLY_ANSWERED`, `FULLY_ANSWERED`)
6. `notification_certificate_get` — one per recipient (`receiverId`); `notification_certificate_document_url` gives the PDF once it is `CERTIFIED`

**Sample agent response:**
> Notification sent to juan@empresa.com and maria@empresa.com — status: SENT. I have requested a delivery certificate for each of them; I'll send you both PDFs once they are certified.

---

## Prompt 3: One certificate for evidences from several groups

**User goal:** Issue a single certificate (dossier) over chosen evidences, possibly from several groups.

**Prompt:**
```
In case file <caseFileId>, issue one certificate named "Expediente obra Calle Mayor" that covers
the delivery note, the photos and the signed acta.
```

**Expected tool sequence:**
1. `dossier_template_list` — the available templates; pick one and read the fields it needs
2. `dossier_create` — a DRAFT dossier from that template (you generate its `id`; the call returns no body)
3. `dossier_evidence_list_to_link` — the `COMPLETED` evidences that can be linked; find the three
4. `dossier_evidence_link` — links them (once per case file that holds them)
5. `dossier_certify` — poll `dossier_get` until `CERTIFIED` (it returns to `DRAFT` if certification fails)
6. `dossier_document_url` — the certificate PDF

**Sample agent response:**
> Certificate "Expediente obra Calle Mayor" (`<dossierId>`) covers the delivery note, 12 photos and the signed acta. It is CERTIFIED; here is the download link: `<url>`.

---

## Prompt 4: Start a certified chat and get the transcript certificate

**User goal:** Create a certified real-time chat session and obtain a legal transcript.

**Prompt:**
```
Set up a certified chat between me and cliente@acme.com. Give me the invitation URL they should
use to join, and tell me how to get the transcript certificate when we're done.
```

**Expected tool sequence:**
1. `chat_create` — creates the certified chat session
2. `chat_invitation_url` — generates the join URL for the external participant

**Sample agent response:**
> Certified chat created (`<chatId>`). Share this Telegram invitation with cliente@acme.com: `https://t.me/+…`. When the conversation is over, I'll certify the range of messages you choose with `chat_certificate_create` and fetch the certificate with `chat_certificate_get`.

---

## Prompt 5: Check my session and list available case files

**User goal:** Verify the current auth session and see what case files are available.

**Prompt:**
```
Who am I logged in as, and what case files do I have access to?
```

**Expected tool sequence:**
1. `session_info` — who is signed in: `userId`, `email`, `companyId`, `defaultCaseFileId`
2. `case_file_list` — lists accessible case files with IDs and names

**Sample agent response:**
> You are signed in as ana.garcia@empresa.com. You have access to 4 case files: (1) "Proyecto Alpha" (`cf_001`), (2) "Due Diligence XYZ" (`cf_002`), (3) "Contencioso 2026" (`cf_003`), (4) "Notificaciones Q1" (`cf_004`). Which case file would you like to work with?

---

## Prompt 6: Get a document signed in one call

**User goal:** Send a PDF for signature to one person, with the link by WhatsApp too, and copy a colleague.

**Prompt:**
```
Send /Users/me/docs/acuerdo.pdf for signature to Marta Ruiz (marta@cliente.com, +34 611 222 333) —
send her the link by WhatsApp too. Copy Jorge Díaz (jorge@empresa.com) as an observer.
Case file: <caseFileId>.
```

**Expected tool sequence:**
1. *(agent reads the PDF)* — finds the page with the signature block and where Marta signs (signature guide, "Placing signatures")
2. `signature_request_full` — the document, Marta as signatory with her phone, `sendWaUrl: true` and a position, Jorge as observer; returns the `requestId` with status `ACTIVE`
3. `signature_request_get` — later, until the request is `COMPLETED`
4. `signature_certificate_get` — the signature certificate, available once the request is `COMPLETED`

**Sample agent response:**
> Sent: request `<requestId>` is ACTIVE. Marta has the signing link by email and WhatsApp; Jorge gets a read-only copy. I'll let you know when she has signed.

---

## Prompt 7: Leave one evidence out of an express certificate

**User goal:** Certify a sealed evidence group without one of its evidences.

**Prompt:**
```
In case file <caseFileId>, the group "Contrato y anexos" is already sealed. Issue its
certificate, but leave out the file titled "borrador-v1.pdf".
```

**Expected tool sequence:**
1. `evidence_group_get` — confirms the group is `CLOSED` (the API does not require it, but sealing before certifying is advised)
2. `evidence_list` — finds the id of "borrador-v1.pdf" (evidences created through the API start with `relevant: true`) and checks every evidence is `COMPLETED`: `dossier_group_certify` leaves out any other without an error
3. `evidence_update` — `relevant: false` on that evidence; `evidence_get` confirms it (the update returns no body)
4. `dossier_group_certify` — without `evidenceIds`, so it certifies only the group's relevant evidences
5. `dossier_get` — until the dossier is `CERTIFIED`; then `dossier_document_url` for the PDF

**Sample agent response:**
> "borrador-v1.pdf" is now marked as not relevant, so certificate `<dossierId>` covers the other evidences of "Contrato y anexos". It is certifying; once it is CERTIFIED I'll send you the PDF link.

---

## Prompt 8: Close a finished case file

**User goal:** Close a case file so that no new evidence is added to it by mistake.

**Prompt:**
```
The "Due Diligence XYZ" matter is finished. Close its case file.
```

**Expected tool sequence:**
1. `session_info` → `case_file_list` — finds the case file's `id` (not its `code`)
2. `case_file_update` — `status: CLOSED` (needs the editor role or higher; the personal case file cannot be updated)
3. `case_file_get` — confirms `status: CLOSED` (the update returns no body)

**Sample agent response:**
> Case file "Due Diligence XYZ" (`<caseFileId>`) is now CLOSED. New evidence groups and evidences will be refused there until it is reopened (`status: OPEN`).

---

## Prompt 9: Certify part of an existing chat

**User goal:** Find an existing certified Telegram chat and certify yesterday's messages.

**Prompt:**
```
Certify yesterday's messages in my Telegram chat "Obra Calle Mayor".
```

**Expected tool sequence:**
1. `session_info` → `defaultCaseFileId`, the personal case file (chats live there)
2. `chat_list` — `filter.search: "Obra Calle Mayor"` → the `chatId` (status `active`; a chat still `creating` answers 404 for its messages)
3. `chat_message_list` — `filter.writtenFrom` / `filter.writtenTo` = yesterday → confirms there are messages to certify
4. `chat_get` — reads `registeredAt` (`chatMessagesFrom` must be at or after it)
5. `chat_certificate_create` — `chatMessagesFrom` / `chatMessagesTo` = yesterday's range
6. `chat_certificate_get` — until `CERTIFIED`; `documentUrl` is the PDF

**Sample agent response:**
> Found "Obra Calle Mayor" (active). Yesterday it has 42 messages, from 08:15 to 19:02. Certificate `<certificateId>` for that range is CERTIFIED; here is the download link: `<documentUrl>`.
