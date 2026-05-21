# Agent Prompts — GoCertius MCP Server

End-to-end prompt examples with their expected tool sequences. Use these as starting points or copy them directly into Claude.

For step-by-step guided workflows, use the bundled slash-commands:
- `/evidence-lifecycle` — evidence creation + seal + certificate
- `/dossier-lifecycle` — dossier workflow from template selection
- `/notification-lifecycle` — certified notification from creation to delivery certificate
- `/chat-lifecycle` — certified chat setup and transcript certificate

---

## Prompt 1: Certify a document with blockchain anchoring

**User goal:** Create certified evidence from an existing document and obtain a legal certificate.

**Prompt:**
```
I need to certify the contract at /Documents/contrato-servicio.pdf as legally binding evidence.
Create an evidence group called "Contrato Q1 2026", add the document as evidence, then seal it
and give me the certificate ID. Use case file <caseFileId>.
```

**Expected tool sequence:**
1. `evidence_group_create` — creates the group named "Contrato Q1 2026"
2. `evidence_create` — uploads the PDF as a certified evidence item
3. `evidence_seal` (pollable — returns a task) → polls until `completed`
4. `evidence_get` — retrieves the certificate ID from the sealed evidence

**Sample agent response:**
> Certified evidence created successfully. Evidence Group ID: `eg_abc123`. The document was sealed at 14:32 UTC with blockchain anchor. Certificate ID: `cert_xyz789`. You can download the legal certificate using the certificate ID.

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
1. `notification_request_create` (pollable) — creates and sends the notification
2. `notification_receiver_add` × 2 — adds each recipient
3. `notification_request_send` — dispatches to all receivers
4. `notification_request_status` — polls until `DELIVERED`
5. `notification_certificate_get` — retrieves the legal delivery certificate

**Sample agent response:**
> Notification sent to 2 recipients. Status: DELIVERED (both recipients). Certificate ID: `notif_cert_456`. The legal delivery certificate confirms both juan@empresa.com and maria@empresa.com received the notification at 14:45 UTC.

---

## Prompt 3: Create a dossier for multi-party document exchange

**User goal:** Set up a document exchange workflow using a dossier template.

**Prompt:**
```
List the available dossier templates, pick the one for "firma de contrato", create a dossier
called "Contrato Empresa ABC" and tell me what documents I need to upload.
```

**Expected tool sequence:**
1. `dossier_template_list` — lists available templates
2. `dossier_create` — creates dossier from the selected template
3. `dossier_get` — retrieves dossier details including required document slots

**Sample agent response:**
> Found 3 dossier templates. Selected "Firma de Contrato" (template ID: `tpl_789`). Created dossier "Contrato Empresa ABC" (ID: `dos_321`). Required documents: (1) Contrato firmado — PDF, max 10 MB; (2) DNI del firmante — PDF or JPG. Upload these using the dossier tools when ready.

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
> Certified chat created (ID: `chat_567`). Invitation URL for cliente@acme.com: `https://app.gocertius.io/chat/join/abc123xyz`. Share this link with your client. Once the chat ends, call `chat_certificate_get` with ID `chat_567` to obtain the legal transcript certificate.

---

## Prompt 5: Check my session and list available case files

**User goal:** Verify the current auth session and see what case files are available.

**Prompt:**
```
Who am I logged in as, and what case files do I have access to?
```

**Expected tool sequence:**
1. `session_info` — returns the authenticated user's profile
2. `case_file_list` — lists accessible case files with IDs and names

**Sample agent response:**
> Logged in as **Ana García** (ana.garcia@empresa.com) — role: admin. You have access to 4 case files: (1) "Proyecto Alpha" (`cf_001`), (2) "Due Diligence XYZ" (`cf_002`), (3) "Contencioso 2026" (`cf_003`), (4) "Notificaciones Q1" (`cf_004`). Which case file would you like to work with?
