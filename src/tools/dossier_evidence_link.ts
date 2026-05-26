// Custom tool: dossier_evidence_link — spec bug workaround: LinkDossierEvidencesController_run
// omits caseFileId from path params even though the URL requires it.
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { linkDossierEvidencesControllerRun } from "../api/sdk.gen.js";
import { defineTool } from "../core/index.js";

export const dossier_evidence_link = defineTool({
  name: "dossier_evidence_link",
  description:
    "Links specific evidence items to a DRAFT dossier. " +
    "Call once per case file containing evidences to link. " +
    "After linking all evidences, call dossier_certify to finalize. " +
    "For a single-group dossier, use dossier_group_certify instead (one step). " +
    "Example: dossier_evidence_link({ caseFileId: '...', dossierId: '...', caseFileToLinkId: '...', ids: ['ev-uuid-1', 'ev-uuid-2'] })",
  inputSchema: z.object({
    caseFileId: z.string().describe("UUID of the case file that owns the dossier"),
    dossierId: z.string().describe("UUID of the DRAFT dossier to link evidences to"),
    caseFileToLinkId: z
      .string()
      .describe("UUID of the case file containing the evidences (often same as caseFileId)"),
    ids: z.array(z.string().uuid()).describe("UUIDs of the evidence items to link"),
  }),
  annotations: { destructive: false, idempotent: false, requiresUserConfirmation: false },
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
