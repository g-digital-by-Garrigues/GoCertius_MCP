// Custom tool: evidence_upload — uploads a local file (path or base64) as evidence in one step.
// Computes the SHA-256 locally, registers the evidence record (custodyType INTERNAL), then PUTs the
// bytes to the presigned S3 URL — so clients without code execution (e.g. Claude Desktop) can attach
// files without pre-hashing or a manual PUT. Custom-only tool (no backing OpenAPI op); registered via
// product.config customOnlyTools (STR-E13-05).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { createEvidenceControllerRun } from "../api/sdk.gen.js";
import { defineTool, httpRequestContext } from "../core/index.js";

const MAX_FILE_BYTES = 1024 ** 3; // 1 GiB
const MAX_BASE64_BYTES = 10 * 1024 * 1024; // ~10 MB decoded

export const evidence_upload = defineTool({
  name: "evidence_upload",
  description:
    "Uploads a local file as evidence in one step: computes its SHA-256, registers the evidence " +
    "record (custodyType INTERNAL = GoCertius stores the file), and uploads the bytes to S3 — no " +
    "manual hashing or PUT needed. Internally this follows the required GoCertius sequence: " +
    "create INTERNAL evidence → receive uploadFileUrl (presigned S3 URL) → PUT file bytes → " +
    "return uploaded:true. " +
    "Requires: case_file_create → caseFileId, evidence_group_create → evidenceGroupId. " +
    "Provide EXACTLY ONE of `filePath` (absolute local path, stdio/local mode only) or " +
    "`contentBase64` (base64-encoded file content, ~10 MB max). " +
    "Use evidence_upload when the file is on the local machine; use evidence_create when you already " +
    "have the SHA-256 hash, need to inspect/use uploadFileUrl manually, or have a public fileUrl. " +
    "After this tool succeeds, verify with evidence_get/evidence_list and only then call evidence_seal. " +
    "If this tool fails before returning an evidence id, check evidence_list before retrying; if retrying " +
    "manually, use evidence_create with a fresh UUID. Local files must be under 1 GiB.",
  inputSchema: z
    .object({
      caseFileId: z.string().uuid().describe("UUID of the case file"),
      evidenceGroupId: z.string().uuid().describe("UUID of the evidence group"),
      title: z.string().max(128).describe("Human-readable title for the evidence"),
      fileName: z.string().describe("File name including extension"),
      filePath: z
        .string()
        .optional()
        .describe(
          "Absolute local path to the file (stdio/local mode only). The tool will create evidence, receive uploadFileUrl, and PUT this file to it.",
        ),
      contentBase64: z
        .string()
        .optional()
        .describe(
          "Base64-encoded file content (~10 MB max). The tool will create evidence, receive uploadFileUrl, and PUT these bytes to it.",
        ),
    })
    .refine((v) => !!v.filePath !== !!v.contentBase64, {
      message: "Provide exactly one of filePath or contentBase64",
    }),
  annotations: {
    title: "Evidence Upload",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(input, ctx) {
    const { caseFileId, evidenceGroupId, title, fileName, filePath, contentBase64 } = input as {
      caseFileId: string;
      evidenceGroupId: string;
      title: string;
      fileName: string;
      filePath?: string;
      contentBase64?: string;
    };

    // Security: an HTTP (multi-user) server must never read arbitrary local paths.
    if (filePath && httpRequestContext.getStore()) {
      throw new Error("filePath is only available in stdio (local) mode — use contentBase64");
    }

    let fileBuffer: Buffer;
    if (filePath) {
      const info = await stat(filePath);
      if (info.size > MAX_FILE_BYTES) {
        throw new Error("evidence_upload: file exceeds the 1 GiB limit");
      }
      fileBuffer = await readFile(filePath);
    } else {
      fileBuffer = Buffer.from(contentBase64 ?? "", "base64");
      if (fileBuffer.byteLength > MAX_BASE64_BYTES) {
        throw new Error("evidence_upload: contentBase64 exceeds the ~10 MB limit");
      }
    }

    const hashHex = createHash("sha256").update(fileBuffer).digest("hex");
    const hashB64 = createHash("sha256").update(fileBuffer).digest("base64");
    const id = randomUUID();

    const token = ctx.auth?.token ?? "";
    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const response = await createEvidenceControllerRun({
      client: sdkClient,
      body: {
        id,
        title,
        fileName,
        hash: hashHex,
        custodyType: "INTERNAL",
        caseFileId,
        evidenceGroupId,
      } as any,
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null
          ? JSON.stringify(response.error)
          : String(response.error);
      throw new Error(`evidence_upload API error: ${msg}`);
    }

    const data = response.data as Record<string, unknown> | undefined;
    const uploadFileUrl = data?.uploadFileUrl as string | undefined;
    if (!uploadFileUrl) {
      throw new Error("evidence_upload: API did not return an uploadFileUrl");
    }

    const uploadResponse = await fetch(uploadFileUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-amz-checksum-sha256": hashB64,
      },
      body: new Uint8Array(fileBuffer),
      signal: AbortSignal.timeout(120_000),
    });
    if (!uploadResponse.ok) {
      throw new Error(`evidence_upload: S3 upload failed (HTTP ${uploadResponse.status})`);
    }

    return { id, hash: hashHex, uploaded: true };
  },
});
