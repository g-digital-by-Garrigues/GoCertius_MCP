// Custom tool: signature_request_full — Story 22-08 (E22). Same file in GoCertius and EAD Enterprise
// Suite (only the default host differs). Custom-only tool (customOnlyTools).
//
// One call instead of about eight, including the byte upload an agent cannot do itself:
//   [GET request by id: retry check] → POST request → per document { POST document → PUT bytes with
//   x-amz-checksum-sha256 } → per signatory and observer { POST participant, linked to every document } →
//   per signatory and document { PUT coordinates } → poll documents until READY_TO_SIGN → PUT activate.
//
// Backend facts this relies on (g-certius-back `pro` + Signature Manager, read 2026-11-26 — see the story):
// - Creating a request twice with the same id is NOT idempotent (500, and an orphan in Signature
//   Manager), so a known requestId is looked up first and never re-created (NFR4). The lookup is scoped to
//   the case file: a requestId reused in ANOTHER case file still collides — hence "a NEW requestId".
// - Coordinates take the PARTICIPANT id; they are replaced as a whole (retry-safe) and can be set while a
//   document is still PENDING (PDF conversion keeps them).
// - Coordinates are required at activation for every document that is a PDF, or a .docx sent with
//   convertToPdf, for every signatory linked to it — whatever the signature type. That, and every other
//   rule the platform would apply part-way (phones, file names, deadline, language), is checked BEFORE any
//   request reaches the platform, so a predictable refusal never leaves a half-built draft (a draft cannot
//   be deleted with these tools and counts against the plan).
// - A document that never receives its bytes stays PENDING, and one in ERROR stays there: either blocks
//   activation for good, and no tool replaces it — so the upload is retried, and if it still fails the
//   agent is told to start over with a new requestId.
// - The units and origin of x/y are not defined in any code read: they pass through unchanged (story 22-05
//   establishes the convention live; the signature guide states it).
//
// Errors: before the request exists, upstream errors are thrown as UpstreamHttpError (mcp-core may
// refresh the session and run the call again — nothing exists yet), except the create itself (a 5xx may
// still have created it). After it exists, every failure — HTTP or network — is a structured tool error
// carrying the ids created so far and what to do given the request's actual state; a 401 re-authenticates
// once and repeats the step. No signer name, email or phone is ever logged (NFR9).

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import {
  activateSignatureRequestControllerRun,
  createSignatureDocumentControllerRun,
  createSignatureParticipantControllerRun,
  createSignatureRequestControllerRun,
  listSignatureDocumentsControllerRun,
  listSignatureParticipantsControllerRun,
  showSignatureRequestControllerRun,
  updateSignatureCoordinatesControllerRun,
} from "../api/sdk.gen.js";
import {
  defineTool,
  FileInput,
  type ResolvedFile,
  type ToolContext,
  toolError,
  UpstreamHttpError,
} from "../core/index.js";

// biome-ignore lint/suspicious/noExplicitAny: generated SDK functions — types validated at generation time
type SdkFn = (opts: any) => Promise<any>;

const OPERATION = "signature_request_full";
const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";
/** Default wait for READY_TO_SIGN: keeps the whole call under the 60 s most MCP clients allow. */
const DEFAULT_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 3_000;
const PUT_TIMEOUT_MS = 120_000;
const PUT_ATTEMPTS = 3;
const MAX_DOCUMENTS = 20;
const MAX_PEOPLE = 50;
/** A new signatory is linked to the documents asynchronously: retry its first placement for ~10 s. */
const LINK_ATTEMPTS = 6;
const LINK_WAIT_MS = 2_000;

const coordinate = z.object({
  document: z.number().int().min(0),
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
});

const person = {
  firstName: z.string().min(1).max(32),
  lastName: z.string().min(1).max(64),
  email: z.string().email(),
};

const inputSchema = z.object({
  caseFileId: z.string().uuid().describe("UUID of the case file (case_file_create → caseFileId)."),
  requestId: z
    .string()
    .uuid()
    .describe(
      "A NEW UUID v4 you generate, never used before in any case file. Reuse it (same caseFileId) to retry: an existing request is reported, never re-created.",
    ),
  name: z.string().min(1).max(64).describe("Name shown to the signers."),
  language: z.enum(["es_ES", "en_GB"]).describe("Language of the signing experience."),
  deadline: z.string().describe("ISO 8601 date-time, in the future, at most 31 days ahead."),
  signatureType: z
    .enum(["INTERPOSITION", "ADVANCED"])
    .optional()
    .describe(
      "INTERPOSITION (default): simple signature, link by email (and WhatsApp/SMS on request). ADVANCED: one-time code to the signer's mobile, so every signatory needs a phone; no WhatsApp/SMS.",
    ),
  closeCondition: z
    .enum(["ALL_REQUIRED", "PARTIAL_ALLOWED"])
    .optional()
    .describe(
      "ALL_REQUIRED (default): it completes when everyone has signed. PARTIAL_ALLOWED: it completes once no signature is pending — a signatory who rejects does not block the others.",
    ),
  documents: z
    .array(
      z.object({
        title: z.string().min(1).max(128),
        file: FileInput.describe("Local path (stdio mode), base64 content or an HTTPS URL."),
        fileName: z
          .string()
          .min(1)
          .optional()
          .describe("With extension; default: the file's own name. Unique per request."),
        convertToPdf: z.boolean().optional().describe("Only for .docx: convert to PDF first."),
      }),
    )
    .min(1)
    .max(MAX_DOCUMENTS)
    .describe(
      "Documents to sign (the plan may allow fewer per request). Every signatory signs every document.",
    ),
  signatories: z
    .array(
      z.object({
        ...person,
        phonePrefix: z.string().optional().describe("With the +, e.g. +34."),
        phoneNumber: z.string().optional().describe("Mobile number, digits only."),
        sendWaUrl: z
          .boolean()
          .optional()
          .describe(
            "INTERPOSITION: also send the link by WhatsApp. With a phone the platform does it unless you pass false.",
          ),
        sendSmsUrl: z
          .boolean()
          .optional()
          .describe(
            "INTERPOSITION: also send the link by RCS/SMS, if the platform has it enabled.",
          ),
        coordinates: z
          .array(coordinate)
          .optional()
          .describe(
            "Where this person signs: {document (index in documents, from 0), page (from 1), x, y} — PDF points from the page's bottom-left corner; (x, y) is the bottom-left corner of the signature stamp (it spans x+15..x+104, y..y+66.5). Required on every PDF.",
          ),
      }),
    )
    .min(1)
    .max(MAX_PEOPLE)
    .describe("People who must sign; a phone is required for ADVANCED."),
  observers: z
    .array(z.object(person))
    .max(MAX_PEOPLE)
    .optional()
    .describe("Receive a read-only copy; never sign."),
  activate: z
    .boolean()
    .optional()
    .describe(
      "true (default): send it once the documents are ready — irreversible, confirm with your user. false: leave a DRAFT.",
    ),
  waitSeconds: z
    .number()
    .int()
    .min(0)
    .max(300)
    .optional()
    .describe(
      `Wait for READY_TO_SIGN before sending (default ${DEFAULT_WAIT_SECONDS}; keep the call under your client's timeout); if not ready, it stays a DRAFT.`,
    ),
});

type Input = z.infer<typeof inputSchema>;

/** The platform accepts convertToPdf only when the file name ends in ".docx" — case-sensitive, like it. */
const isDocx = (name: string) => name.endsWith(".docx");

/** A PDF (its header may sit anywhere in the first 1024 bytes), or a .docx converted to PDF. */
function needsCoordinates(file: ResolvedFile, fileName: string, convertToPdf: boolean): boolean {
  const pdfBytes = file.bytes.subarray(0, 1024).includes("%PDF");
  return pdfBytes || fileName.toLowerCase().endsWith(".pdf") || (convertToPdf && isDocx(fileName));
}

function inputError(problem: string, remediation: string): never {
  throw toolError({ operation: OPERATION, upstream: new Error(problem), remediation });
}

/** Rules that need no file: checked first, so a bad call does not download anything. */
function validatePeople(input: Input): void {
  const advanced = input.signatureType === "ADVANCED";
  const emails = new Set<string>();
  for (const p of [...input.signatories, ...(input.observers ?? [])]) {
    const e = p.email.toLowerCase();
    if (emails.has(e)) {
      inputError(
        "Two participants share an email address; the platform allows each address once per request.",
        "Give every signatory and observer a different email.",
      );
    }
    emails.add(e);
  }
  const due = Date.parse(input.deadline);
  if (Number.isNaN(due) || due <= Date.now() || due > Date.now() + 31 * 24 * 3600 * 1000) {
    inputError(
      `deadline "${input.deadline}" must be an ISO 8601 date-time in the future, at most 31 days ahead.`,
      "Send a deadline within the next 31 days.",
    );
  }
  const phones = new Set<string>();
  input.signatories.forEach((s, i) => {
    const hasPrefix = !!s.phonePrefix;
    const hasNumber = !!s.phoneNumber;
    if (hasPrefix !== hasNumber) {
      inputError(
        `Signatory ${i} has only one of phonePrefix / phoneNumber; the platform needs both or neither.`,
        "Send both (prefix with the +, e.g. +34) or neither.",
      );
    }
    if (hasPrefix && !/^\+\d{1,4}$/.test(s.phonePrefix ?? "")) {
      inputError(
        `Signatory ${i}'s phonePrefix "${s.phonePrefix}" must be a + followed by 1 to 4 digits, e.g. +34.`,
        "Fix phonePrefix (the + is required).",
      );
    }
    if (hasNumber && !/^\d{4,15}$/.test((s.phoneNumber ?? "").replace(/[\s-]/g, ""))) {
      inputError(
        `Signatory ${i}'s phoneNumber must be a mobile number made of digits.`,
        "Send the mobile number as digits (spaces and dashes are tolerated); landlines are refused by the platform.",
      );
    }
    if (hasNumber) {
      const key = `${s.phonePrefix}${(s.phoneNumber ?? "").replace(/[\s-]/g, "")}`;
      if (phones.has(key)) {
        inputError(
          "Two signatories share a phone number; the platform allows each number once per request.",
          "Give each signatory their own mobile number.",
        );
      }
      phones.add(key);
    }
    if ((s.sendWaUrl || s.sendSmsUrl) && !hasNumber) {
      inputError(
        `Signatory ${i} asks for a WhatsApp/SMS link but has no phone.`,
        "Add phonePrefix (with the +) and phoneNumber, or drop sendWaUrl/sendSmsUrl.",
      );
    }
    if (advanced && !hasNumber) {
      inputError(
        `Signatory ${i} has no phone; ADVANCED signatures send the one-time code to that mobile.`,
        "Add phonePrefix (with the +) and phoneNumber, or use INTERPOSITION.",
      );
    }
    if (advanced && (s.sendWaUrl || s.sendSmsUrl)) {
      inputError(
        `Signatory ${i} asks for sendWaUrl/sendSmsUrl, which ADVANCED signatures do not support.`,
        "Drop sendWaUrl/sendSmsUrl, or use INTERPOSITION.",
      );
    }
    for (const c of s.coordinates ?? []) {
      if (c.document >= input.documents.length) {
        inputError(
          `Signatory ${i} has a coordinate for document ${c.document}, but there are only ${input.documents.length} document(s) (indexes from 0).`,
          "Fix the document index in that coordinate.",
        );
      }
    }
  });
}

/** Rules that need the files (names, PDF detection, positions). */
function validateDocuments(
  input: Input,
  docs: { fileName: string; size: number; needsCoords: boolean }[],
): void {
  const names = new Set<string>();
  docs.forEach((d, i) => {
    if (d.size === 0)
      inputError(`Document ${i} ("${d.fileName}") is empty.`, "Send the document's content.");
    if (names.has(d.fileName.toLowerCase())) {
      inputError(
        `Two documents share the file name "${d.fileName}"; the platform refuses that.`,
        "Give each document a different fileName.",
      );
    }
    names.add(d.fileName.toLowerCase());
    if (input.documents[i]?.convertToPdf && !isDocx(d.fileName)) {
      inputError(
        `Document ${i} ("${d.fileName}") asks for convertToPdf, which the platform accepts only for file names ending in ".docx" (lower case).`,
        "Drop convertToPdf for that document, or send the .docx with a lower-case .docx name.",
      );
    }
  });
  if (input.activate === false) return;
  const missing: string[] = [];
  docs.forEach((d, di) => {
    if (!d.needsCoords) return;
    input.signatories.forEach((s, si) => {
      if (!(s.coordinates ?? []).some((c) => c.document === di)) {
        missing.push(`signatory ${si} on document ${di} ("${d.fileName}")`);
      }
    });
  });
  if (missing.length > 0) {
    inputError(
      `Signature position missing — ${missing.join("; ")}. A PDF (or a .docx converted to PDF) needs every signatory's position before it can be sent. Nothing was created.`,
      "Either read the PDF to find the page where each person signs and send coordinates {document, page, x, y} for them (convention in the signature guide), or call again with activate: false to save a draft and tell the user the positions are still needed (for a .docx, place them once you can see the converted PDF).",
    );
  }
}

/** SDK calls for one request: never throw; a 401 re-authenticates once and repeats the step. */
class Api {
  private client: ReturnType<typeof createClient>;
  constructor(private readonly ctx: ToolContext) {
    this.client = Api.make(ctx.auth?.token ?? "", ctx.correlationId);
  }
  private static make(token: string, correlationId?: string) {
    return createClient(
      createConfig({
        baseUrl: BASE_URL,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
        },
      }),
    );
  }
  async call(
    fn: SdkFn,
    opts: Record<string, unknown>,
    reauth: boolean,
  ): Promise<{ data?: unknown; error?: unknown; status: number; thrown?: unknown }> {
    for (let attempt = 0; ; attempt++) {
      let r: { data?: unknown; error?: unknown; response?: Response };
      try {
        r = await fn({ client: this.client, ...opts });
      } catch (err) {
        return { status: 0, thrown: err }; // network failure: no reply at all
      }
      const status = r.response?.status ?? 0;
      if (
        r.error !== undefined &&
        status === 401 &&
        reauth &&
        attempt === 0 &&
        this.ctx.reauthenticate
      ) {
        const fresh = await this.ctx.reauthenticate();
        this.client = Api.make(fresh.token, this.ctx.correlationId);
        continue;
      }
      return { data: r.data, error: r.error, status };
    }
  }
}

const upstream = (
  r: { error?: unknown; status: number; thrown?: unknown },
  step: string,
): unknown =>
  r.thrown ?? UpstreamHttpError.fromParsedError(r.status, r.error, `${OPERATION} (${step})`);

/** PUT the exact bytes with their checksum; network errors and 5xx are retried. */
async function putBytes(url: string, file: ResolvedFile): Promise<string | undefined> {
  let last = "";
  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt++) {
    try {
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.contentType, "x-amz-checksum-sha256": file.sha256Base64 },
        // A view on the same memory, no copy (the file can be large).
        body: new Uint8Array(
          file.bytes.buffer as ArrayBuffer,
          file.bytes.byteOffset,
          file.bytes.byteLength,
        ),
        signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
      });
      if (put.ok) return undefined;
      last = `storage answered HTTP ${put.status}`;
      if (put.status < 500) return last;
    } catch (err) {
      last = `upload failed (${(err as Error).message})`;
    }
    if (attempt < PUT_ATTEMPTS) await new Promise((r) => setTimeout(r, 1_000 * attempt));
  }
  return `${last}, after ${PUT_ATTEMPTS} attempts`;
}

type DocRow = { id: string; fileName?: string; status?: string };

export const signature_request_full = defineTool({
  name: "signature_request_full",
  description:
    "Creates a signature request, adds its documents (uploading the bytes), adds the signatories one by one and any observers, places each signature, waits for the documents to be processed and SENDS it to the signers — in ONE call, instead of chaining signature_request_create, signature_request_add_document, signature_participant_create, signature_coordinate_set and activate_signature_request. Sending is irreversible: confirm with your user first, or pass activate: false for a draft. " +
    "Requires case_file_create → caseFileId and a NEW requestId (UUID v4); reuse it with the same caseFileId to retry — an existing request is reported, never created twice. Every signatory signs every document. Plan limits on documents and participants per request apply. " +
    "A PDF (or a .docx with convertToPdf) needs a position for every signatory: if one is missing the call is refused BEFORE anything is created — read the PDF to find the signature page and send coordinates, or pass activate: false. " +
    "Returns requestId, document/signatory/observer ids and the status: ACTIVE once sent; DRAFT with activate: false or if the documents were still processing (then use activate_signature_request). If a later step fails, the error lists the ids created, the request's state and what to do.",
  inputSchema,
  annotations: {
    title: "Signature Request Full",
    readOnlyHint: false,
    // It messages real people and cannot be undone once sent — like notification_send.
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  pollable: false,
  // Retry safety comes from the requestId check, not from mcp-core's result cache.
  idempotencyWindowSeconds: 0,
  async execute(rawInput, ctx) {
    const input = rawInput as Input;
    const { caseFileId, requestId } = input;
    const request = { caseFileId, requestId };
    const api = new Api(ctx);

    // 1. Every rule the platform would enforce part-way — before any platform request.
    validatePeople(input);
    const files: ResolvedFile[] = [];
    for (const d of input.documents) files.push(await ctx.files.resolve(d.file));
    const docs = input.documents.map((d, i) => {
      const file = files[i] as ResolvedFile;
      const fileName = d.fileName ?? file.filename;
      return {
        fileName,
        size: file.size,
        needsCoords: needsCoordinates(file, fileName, d.convertToPdf === true),
      };
    });
    validateDocuments(input, docs);

    const listDocs = async (): Promise<{
      rows?: DocRow[];
      r: Awaited<ReturnType<Api["call"]>>;
    }> => {
      const r = await api.call(
        listSignatureDocumentsControllerRun as SdkFn,
        { path: request, query: { page: { number: 1, size: 100 } } },
        true,
      );
      return {
        r,
        rows:
          r.error === undefined && !r.thrown
            ? ((r.data as { data?: DocRow[] })?.data ?? [])
            : undefined,
      };
    };

    // 2. Retry check: an existing request is reported (with what it holds), never created again.
    const existing = await api.call(
      showSignatureRequestControllerRun as SdkFn,
      { path: request },
      false,
    );
    if (existing.error === undefined && !existing.thrown) {
      const status = (existing.data as { status?: string } | undefined)?.status;
      const { rows } = await listDocs();
      const people = await api.call(
        listSignatureParticipantsControllerRun as SdkFn,
        { path: request },
        true,
      );
      const participants = ((people.data as { data?: { role?: string }[] } | undefined)?.data ?? [])
        .length;
      return {
        requestId,
        status,
        alreadyExisted: true,
        documents: (rows ?? []).map((d) => ({
          documentId: d.id,
          fileName: d.fileName,
          status: d.status,
        })),
        participants,
        next: `A request with this requestId already exists (status ${status}, ${(rows ?? []).length} document(s), ${participants} participant(s)); this call created and changed nothing. If it is a DRAFT that a failed or timed-out call left half-built, finish it with the step-by-step tools (signature_request_add_document, signature_participant_create, signature_coordinate_set, activate_signature_request) or start over with a new requestId.`,
      };
    }
    if (existing.thrown || existing.status !== 404) {
      throw upstream(existing, "check whether the request exists");
    }

    // 3. Create the request. A 5xx or a lost reply may still have created it, so it is never re-run blind.
    const created = await api.call(
      createSignatureRequestControllerRun as SdkFn,
      {
        path: { caseFileId },
        body: {
          id: requestId,
          name: input.name,
          language: input.language,
          deadline: input.deadline,
          sequence: "PARALLEL",
          ...(input.signatureType ? { signatureType: input.signatureType } : {}),
          ...(input.closeCondition ? { closeCondition: input.closeCondition } : {}),
        },
      },
      false,
    );
    if (created.thrown || created.status >= 500) {
      throw toolError({
        operation: OPERATION,
        upstream: upstream(created, "create the request"),
        remediation: `The platform may or may not have created request ${requestId}. Call signature_request_full again with the SAME requestId and caseFileId: an existing request is reported, not duplicated. If that also fails, use a NEW requestId (an id already used in another case file always fails this way).`,
        suggestedTool: "signature_request_get",
      });
    }
    if (created.error !== undefined) throw upstream(created, "create the request");

    // From here on the request exists: failures carry the ids, they never re-run the call.
    const documentIds: string[] = [];
    const signatoryIds: string[] = [];
    const observerIds: string[] = [];
    let stuck = ""; // a document that can never become READY_TO_SIGN
    const fail = async (step: string, err: unknown): Promise<never> => {
      const now = await api.call(
        showSignatureRequestControllerRun as SdkFn,
        { path: request },
        true,
      );
      const state = (now.data as { status?: string } | undefined)?.status ?? "unknown";
      const ids = `documents: [${documentIds.join(", ")}]; signatories: [${signatoryIds.join(", ")}]; observers: [${observerIds.join(", ")}]`;
      const what =
        state !== "DRAFT" && state !== "unknown"
          ? `Its status is ${state}, so it WAS sent despite the error: follow it with signature_request_get; do not activate it again.`
          : stuck
            ? `${stuck} — such a document stays there and blocks activation for good, and no tool replaces it: start over with signature_request_full and a NEW requestId (this draft stays as a DRAFT).`
            : "Inspect it with signature_request_get, signature_document_list and signature_participant_list; complete it with signature_request_add_document, signature_participant_create, signature_coordinate_set and activate_signature_request. Calling signature_request_full again with this requestId only reports it.";
      throw toolError({
        operation: OPERATION,
        upstream: err,
        remediation: `Signature request ${requestId} exists (status ${state}) but the step "${step}" failed. Created so far — ${ids}. ${what}`,
        suggestedTool: "signature_request_get",
      });
    };

    // 4. Documents: register, then upload the exact bytes with their checksum (retried).
    for (const [i, d] of input.documents.entries()) {
      const file = files[i] as ResolvedFile;
      const fileName = (docs[i] as { fileName: string }).fileName;
      const documentId = randomUUID();
      const step = `add document ${i} ("${fileName}")`;
      const reg = await api.call(
        createSignatureDocumentControllerRun as SdkFn,
        {
          path: request,
          body: {
            id: documentId,
            title: d.title,
            fileName,
            hash: file.sha256,
            fileSize: file.size,
            ...(d.convertToPdf ? { convertToPdf: true } : {}),
          },
        },
        true,
      );
      if (reg.error !== undefined || reg.thrown) return fail(step, upstream(reg, step));
      documentIds.push(documentId);
      const url = (reg.data as { url?: string } | undefined)?.url;
      if (!url) {
        stuck = `Document ${documentId} ("${fileName}") was registered without an upload URL (its registration failed, so it is in ERROR)`;
        return fail(step, new Error("the platform returned no upload URL"));
      }
      const putError = await putBytes(url, file);
      if (putError) {
        stuck = `Document ${documentId} ("${fileName}") never received its bytes, so it stays PENDING`;
        return fail(`upload ${step}`, new Error(putError));
      }
    }

    // 5. Participants one by one (bulk creation cannot set sendWaUrl/sendSmsUrl), linked to every document.
    for (const [i, s] of input.signatories.entries()) {
      const id = randomUUID();
      const r = await api.call(
        createSignatureParticipantControllerRun as SdkFn,
        {
          path: request,
          body: {
            id,
            role: "SIGNATORY",
            firstName: s.firstName,
            lastName: s.lastName,
            email: s.email,
            linkToAllDocuments: true,
            ...(s.phonePrefix ? { phonePrefix: s.phonePrefix } : {}),
            ...(s.phoneNumber ? { phoneNumber: s.phoneNumber.replace(/[\s-]/g, "") } : {}),
            ...(s.sendWaUrl !== undefined ? { sendWaUrl: s.sendWaUrl } : {}),
            ...(s.sendSmsUrl !== undefined ? { sendSmsUrl: s.sendSmsUrl } : {}),
          },
        },
        true,
      );
      if (r.error !== undefined || r.thrown) {
        return fail(`add signatory ${i}`, upstream(r, `add signatory ${i}`));
      }
      signatoryIds.push(id);
    }
    for (const [i, o] of (input.observers ?? []).entries()) {
      const id = randomUUID();
      const r = await api.call(
        createSignatureParticipantControllerRun as SdkFn,
        {
          path: request,
          body: {
            id,
            role: "OBSERVER",
            firstName: o.firstName,
            lastName: o.lastName,
            email: o.email,
            linkToAllDocuments: true,
          },
        },
        true,
      );
      if (r.error !== undefined || r.thrown) {
        return fail(`add observer ${i}`, upstream(r, `add observer ${i}`));
      }
      observerIds.push(id);
    }

    // 6. Positions: per signatory and document, the whole list at once (the platform replaces it).
    for (const [si, s] of input.signatories.entries()) {
      const byDoc = new Map<number, { page: number; x: number; y: number }[]>();
      for (const c of s.coordinates ?? []) {
        byDoc.set(c.document, [...(byDoc.get(c.document) ?? []), { page: c.page, x: c.x, y: c.y }]);
      }
      for (const [di, coordinates] of byDoc) {
        const step = `place signatory ${si} on document ${di}`;
        // The platform links a new signatory to the documents a moment after creating it (seen live on
        // GoCertius production with ADVANCED, story 22-05): until then this answers 404 "Signatory not
        // found". The call replaces the positions as a whole, so repeating it is safe.
        let r = await api.call(
          updateSignatureCoordinatesControllerRun as SdkFn,
          {
            path: { ...request, documentId: documentIds[di], signatoryId: signatoryIds[si] },
            body: { coordinates },
          },
          true,
        );
        for (let attempt = 1; r.status === 404 && attempt < LINK_ATTEMPTS; attempt++) {
          await new Promise((res) => setTimeout(res, LINK_WAIT_MS));
          r = await api.call(
            updateSignatureCoordinatesControllerRun as SdkFn,
            {
              path: { ...request, documentId: documentIds[di], signatoryId: signatoryIds[si] },
              body: { coordinates },
            },
            true,
          );
        }
        if (r.error !== undefined || r.thrown) return fail(step, upstream(r, step));
      }
    }

    const result = (status: string | undefined, documents: DocRow[], next: string) => ({
      requestId,
      status,
      activated: status !== undefined && status !== "DRAFT",
      documents: documents.map((d, i) => ({
        documentId: d.id,
        fileName: docs[i]?.fileName,
        status: d.status,
      })),
      signatoryIds,
      observerIds,
      next,
    });

    // 7. activate: false → a draft, as asked.
    if (input.activate === false) {
      return result(
        "DRAFT",
        documentIds.map((id) => ({ id })),
        "Saved as a DRAFT, as asked. Add any missing signature positions with signature_coordinate_set, then send it with activate_signature_request once signature_document_list shows every document READY_TO_SIGN.",
      );
    }

    // 8. Wait (bounded) for the documents to be processed.
    const waitSeconds = input.waitSeconds ?? DEFAULT_WAIT_SECONDS;
    const deadline = Date.now() + waitSeconds * 1000;
    let statuses: DocRow[] = documentIds.map((id) => ({ id }));
    for (;;) {
      const { r, rows } = await listDocs();
      if (!rows) return fail("read document statuses", upstream(r, "read document statuses"));
      statuses = documentIds.map((id) => ({ id, status: rows.find((x) => x.id === id)?.status }));
      const broken = statuses.filter((d) => d.status === "ERROR");
      if (broken.length > 0) {
        stuck = `Document(s) ${broken.map((d) => `${d.id} ("${docs[documentIds.indexOf(d.id)]?.fileName}")`).join(", ")} ended in ERROR (the platform could not process the bytes)`;
        return fail("document processing", new Error("a document ended in ERROR"));
      }
      if (statuses.every((d) => d.status === "READY_TO_SIGN")) break;
      if (Date.now() + POLL_INTERVAL_MS > deadline) {
        return result(
          "DRAFT",
          statuses,
          `The documents were still being processed after ${waitSeconds} s, so the request was NOT sent yet. When signature_document_list shows every document READY_TO_SIGN, send it with activate_signature_request (caseFileId, requestId) — after confirming with your user.`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // 9. Send it.
    const act = await api.call(
      activateSignatureRequestControllerRun as SdkFn,
      { path: request },
      true,
    );
    if (act.error !== undefined || act.thrown) return fail("activate", upstream(act, "activate"));
    const after = await api.call(
      showSignatureRequestControllerRun as SdkFn,
      { path: request },
      true,
    );
    const status = (after.data as { status?: string } | undefined)?.status ?? "ACTIVE";
    return result(
      status,
      statuses,
      "Sent: the signers have their invitations. Follow it with signature_request_get or signature_signatory_progress_list (signature_request_resend to remind them). Once the whole request is COMPLETED, get each document's certificate with signature_certificate_get, the signed PDF with signature_document_signed_url and the evidence package with signature_certificate_package_url.",
    );
  },
});
