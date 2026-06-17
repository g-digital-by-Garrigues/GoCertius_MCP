// Custom tool: evidence_create — adds optional fileUrl parameter for automatic S3 upload.
// When fileUrl is provided and custodyType is INTERNAL, the tool downloads the file and
// uploads it to the presigned S3 URL, eliminating the need for a separate PUT call.
// n8n-http: POST /evidences
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { createHash } from "node:crypto";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { createEvidenceControllerRun } from "../api/sdk.gen.js";
import { defineTool, safeDownload } from "../core/index.js";

export const evidence_create = defineTool({
  name: "evidence_create",
  description:
    "Registers a NEW evidence record inside an evidence group. " +
    "Requires: evidence_group_create → evidenceGroupId, case_file_create → caseFileId. " +
    "Generate a UUID v4 for `id`. Compute the SHA-256 hex hash of the file BEFORE calling. " +
    "Normal INTERNAL flow: call evidence_create with custodyType INTERNAL and NO fileUrl; " +
    "the API returns uploadFileUrl, a presigned S3 URL. You MUST PUT the exact file bytes to " +
    "uploadFileUrl, then verify with evidence_get/evidence_list, and ONLY THEN call evidence_seal. " +
    "Do not seal an evidence group until every INTERNAL evidence file has been uploaded. " +
    "Convenience flow: if you pass `fileUrl` (public HTTPS, no redirects, under 1 GiB), " +
    "this tool downloads that URL and PUTs the bytes to uploadFileUrl for you. " +
    "EXTERNAL flow: use custodyType EXTERNAL only when you intentionally register hash-only evidence; " +
    "still generate a fresh UUID for each evidence. If an INTERNAL evidence creation/upload failed " +
    "and you want to retry as EXTERNAL, create a NEW evidence id; do not reuse an id whose outcome is unknown. " +
    "WARNING: the API sometimes returns {code:'EvidenceCreateError'} even when the evidence " +
    "was successfully persisted — always verify with evidence_list before retrying.",
  inputSchema: z.object({
    caseFileId: z.string().uuid().describe("UUID of the case file"),
    evidenceGroupId: z.string().uuid().describe("UUID of the evidence group"),
    id: z.string().uuid().describe("UUID v4 for the new evidence record (idempotency key)"),
    title: z.string().max(128).describe("Human-readable title for the evidence"),
    fileName: z.string().describe("Original file name including extension"),
    hash: z.string().describe("SHA-256 hex digest of the file content (64 hex chars)"),
    custodyType: z
      .enum(["INTERNAL", "EXTERNAL"])
      .default("INTERNAL")
      .describe("INTERNAL = GoCertius stores the file; EXTERNAL = only hash registered"),
    fileUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional public HTTPS URL to download and auto-upload to the returned uploadFileUrl (custodyType INTERNAL only). Omit this when you want the manual presigned-URL flow.",
      ),
  }),
  annotations: {
    title: "Evidence Create",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(input, ctx) {
    const { caseFileId, evidenceGroupId, id, title, fileName, hash, custodyType, fileUrl } =
      input as {
        caseFileId: string;
        evidenceGroupId: string;
        id: string;
        title: string;
        fileName: string;
        hash: string;
        custodyType: "INTERNAL" | "EXTERNAL";
        fileUrl?: string;
      };

    const token = ctx.auth?.token ?? "";
    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const response = await createEvidenceControllerRun({
      client: sdkClient,
      body: { id, title, fileName, hash, custodyType, caseFileId, evidenceGroupId } as any,
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null
          ? JSON.stringify(response.error)
          : String(response.error);
      throw new Error(`evidence_create API error: ${msg}`);
    }

    const data = response.data as Record<string, unknown> | undefined;
    const uploadFileUrl = data?.uploadFileUrl as string | undefined;

    // Auto-upload if fileUrl provided and S3 URL available
    if (fileUrl && uploadFileUrl && custodyType === "INTERNAL") {
      const fileBuffer = await safeDownload(fileUrl);
      const hashB64 = createHash("sha256").update(fileBuffer).digest("base64");

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
        throw new Error(`evidence_create: S3 upload failed (HTTP ${uploadResponse.status})`);
      }

      return { ...data, uploaded: true, uploadFileUrl: undefined };
    }

    return data ?? { id, status: "created" };
  },
});
