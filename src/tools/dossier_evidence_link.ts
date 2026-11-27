// Custom tool: dossier_evidence_link — spec bug workaround: LinkDossierEvidencesController_run
// omits caseFileId from path params even though the URL requires it.
// n8n-http: POST /case-files/{caseFileId}/dossiers/{dossierId}/case-files-to-link/{caseFileToLinkId}/link-evidences
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { linkDossierEvidencesControllerRun } from "../api/sdk.gen.js";
import { defineTool } from "../core/index.js";

export const dossier_evidence_link = defineTool({
  name: "dossier_evidence_link",
  description:
    "Links evidence to a DRAFT dossier. Requires: dossier_create → dossierId, caseFileId. " +
    "caseFileToLinkId is the case file holding the evidence (often caseFileId); call once per " +
    "such case file. Every id in `ids` must be evidence of that case file (else 403; also 403 " +
    "if you are not the dossier's owner or lack the editor role on the case file); " +
    "already-linked ids are skipped. Certifying needs every linked evidence COMPLETED: " +
    "dossier_evidence_list_to_link lists those. The API does not require the evidence group to " +
    "be sealed, but sealing it first (evidence_seal) is advised. Then call dossier_certify. For " +
    "one evidence group, dossier_group_certify creates and certifies in one call.",
  inputSchema: z.object({
    caseFileId: z.string().describe("UUID of the case file that owns the dossier"),
    dossierId: z.string().describe("UUID of the DRAFT dossier to link evidences to"),
    caseFileToLinkId: z
      .string()
      .describe("UUID of the case file containing the evidences (often same as caseFileId)"),
    ids: z.array(z.string().uuid()).describe("UUIDs of the evidence items to link"),
  }),
  annotations: {
    title: "Dossier Evidence Link",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 0,
  async execute(input, ctx) {
    const { caseFileId, dossierId, caseFileToLinkId, ids } = input as {
      caseFileId: string;
      dossierId: string;
      caseFileToLinkId: string;
      ids: string[];
    };
    const token = ctx.auth?.token ?? "";

    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const response = await linkDossierEvidencesControllerRun({
      client: sdkClient,
      path: { caseFileId, dossierId, caseFileToLinkId } as any,
      body: { ids },
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null
          ? JSON.stringify(response.error)
          : String(response.error);
      throw new Error(`dossier_evidence_link error: ${msg}`);
    }

    return response.data ?? { linked: true, dossierId, count: ids.length };
  },
});
