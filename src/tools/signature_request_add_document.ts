// Custom tool: signature_request_add_document — registers a document in a DRAFT signature request and,
// with `fileUrl`, downloads it (through mcp-core's guarded resolver: HTTPS, no private networks, size cap,
// timeout), checks it against `hash` BEFORE registering, and uploads it to the presigned URL.
// n8n-http: POST /case-files/{caseFileId}/signature-requests/{requestId}/documents
// Same file in GoCertius and EAD Enterprise Suite (only the default host differs).

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { createSignatureDocumentControllerRun } from "../api/sdk.gen.js";
import { defineTool, type ResolvedFile, toolError, UpstreamHttpError } from "../core/index.js";

const BASE_URL = process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io";
const PUT_ATTEMPTS = 3;

export const signature_request_add_document = defineTool({
  name: "signature_request_add_document",
  description:
    "Adds a document to a DRAFT signature request. Requires: signature_request_create → requestId, case_file_create → caseFileId. Give the document a new UUID as `id` (it is the documentId for coordinates and certificates) and the SHA-256 hex `hash` of its exact bytes. Without `fileUrl` it returns `url`, a presigned upload URL: PUT the exact bytes there with header x-amz-checksum-sha256 = base64 of the same SHA-256. With `fileUrl` (HTTPS) the tool downloads the file itself (size and private-network guards), refuses before registering anything if it does not match `hash` (telling you the right one), and uploads it. Processing is asynchronous: poll signature_document_list until the document is READY_TO_SIGN (ERROR: the bytes or the registration failed). A registered document that never receives its bytes stays PENDING and blocks activation. convertToPdf only for a file name ending in .docx. Not after activate_signature_request. For CONFIGURABLE sequence: `groupId` must reference a Document type group (not Signatory or DocumentSignatory) — a wrong group type returns 'Signature group not found'. To create, fill and send a request in one call, use signature_request_full.",
  inputSchema: z.object({
    caseFileId: z.string().describe("UUID of the case file"),
    requestId: z.string().describe("UUID of the signature request (DRAFT)"),
    id: z
      .string()
      .describe(
        "UUID for the document — becomes documentId for coordinate_set and certificate_get",
      ),
    title: z.string().describe("Document title shown to signatories"),
    fileName: z.string().describe("File name including extension (e.g. contract.pdf)"),
    hash: z.string().describe("SHA-256 hex digest of the PDF content (64 hex chars)"),
    fileSize: z.number().optional().describe("File size in bytes (optional)"),
    groupId: z
      .string()
      .optional()
      .describe("For CONFIGURABLE sequence: ID of a Document type group"),
    convertToPdf: z.boolean().optional().describe("Convert non-PDF to PDF before processing"),
    fileUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional public URL to download and auto-upload the PDF to S3. Eliminates the manual PUT step.",
      ),
  }),
  annotations: {
    title: "Signature Request Add Document",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(input, ctx) {
    const {
      caseFileId,
      requestId,
      id,
      title,
      fileName,
      hash,
      fileSize,
      groupId,
      convertToPdf,
      fileUrl,
    } = input as {
      caseFileId: string;
      requestId: string;
      id: string;
      title: string;
      fileName: string;
      hash: string;
      fileSize?: number;
      groupId?: string;
      convertToPdf?: boolean;
      fileUrl?: string;
    };

    // With fileUrl: download through the guarded resolver and check the hash BEFORE registering anything.
    let file: ResolvedFile | undefined;
    if (fileUrl) {
      file = await ctx.files.resolve({ source: "url", url: fileUrl });
      if (file.sha256.toLowerCase() !== hash.toLowerCase()) {
        throw toolError({
          operation: "signature_request_add_document",
          upstream: new Error(
            `the file at fileUrl does not match hash (its SHA-256 is ${file.sha256}); nothing was registered`,
          ),
          remediation: `Call again with hash "${file.sha256}" if fileUrl points at the right document.`,
        });
      }
    }

    const sdkClient = createClient(
      createConfig({
        baseUrl: BASE_URL,
        headers: {
          Authorization: `Bearer ${ctx.auth?.token ?? ""}`,
          ...(ctx.correlationId ? { "X-Correlation-Id": ctx.correlationId } : {}),
        },
      }),
    );
    const body: Record<string, unknown> = { id, title, fileName, hash };
    if (fileSize !== undefined) body.fileSize = fileSize;
    else if (file) body.fileSize = file.size;
    if (groupId !== undefined) body.groupId = groupId;
    if (convertToPdf !== undefined) body.convertToPdf = convertToPdf;

    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const create = createSignatureDocumentControllerRun as (opts: any) => Promise<any>;
    const response = await create({ client: sdkClient, path: { caseFileId, requestId }, body });
    if (response.error !== undefined) {
      // Nothing was registered: a structured upstream error (mcp-core may refresh a 401 and retry).
      throw UpstreamHttpError.fromParsedError(
        response.response?.status ?? 0,
        response.error,
        "signature_request_add_document",
      );
    }
    const data = response.data as Record<string, unknown> | undefined;
    const presignedUrl = (data?.url ?? data?.uploadFileUrl) as string | undefined;
    if (!file) return data ?? { url: presignedUrl };

    // From here the document exists: failures say which, and what it means for the request.
    const stuck = (what: string) =>
      toolError({
        operation: "signature_request_add_document",
        upstream: new Error(what),
        remediation: `Document ${id} is registered but ${what.includes("URL") ? "in ERROR" : "without its bytes (it stays PENDING)"}; it blocks activation and no tool replaces it. Check signature_document_list; if it is stuck, start the request over.`,
      });
    if (!presignedUrl) throw stuck("the platform returned no upload URL (registration failed)");
    let last = "";
    for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt++) {
      try {
        const put = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.contentType, "x-amz-checksum-sha256": file.sha256Base64 },
          // A view on the same memory, no copy (the file can be large).
          body: new Uint8Array(
            file.bytes.buffer as ArrayBuffer,
            file.bytes.byteOffset,
            file.bytes.byteLength,
          ),
          signal: AbortSignal.timeout(120_000),
        });
        if (put.ok) return { documentId: id, uploaded: true };
        last = `storage answered HTTP ${put.status}`;
        if (put.status < 500) break;
      } catch (err) {
        last = `upload failed (${(err as Error).message})`;
      }
      if (attempt < PUT_ATTEMPTS) await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
    throw stuck(`${last}, after the upload was attempted`);
  },
});
