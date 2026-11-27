// Custom tool: dossier_certify — spec bug workaround: CertifyDossierController_run omits
// caseFileId from the path params even though the URL requires it.
// n8n-http: PUT /case-files/{caseFileId}/dossiers/{dossierId}/certify
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { certifyDossierControllerRun } from "../api/sdk.gen.js";
import { defineTool } from "../core/index.js";

export const dossier_certify = defineTool({
  name: "dossier_certify",
  description:
    "Certifies a DRAFT dossier, generating its certificate (403 if not DRAFT; also 403 if you " +
    "are not the dossier's owner or lack the editor role on the case file). Requires: " +
    "dossierId, caseFileId, and at least one evidence linked with dossier_evidence_link, all " +
    "COMPLETED and no more than the platform's maximum, else 409. ASYNC: DRAFT → CERTIFYING → " +
    "CERTIFIED, or back to DRAFT if certification fails (then call it again); poll dossier_get " +
    "until CERTIFIED, then " +
    "download with dossier_document_url. For one evidence group, dossier_group_certify creates " +
    "and certifies in one call.",
  inputSchema: z.object({
    caseFileId: z.string().describe("UUID of the case file that owns this dossier"),
    dossierId: z.string().describe("UUID of the dossier to certify (must be in DRAFT status)"),
  }),
  annotations: {
    title: "Dossier Certify",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(input, ctx) {
    const { caseFileId, dossierId } = input as { caseFileId: string; dossierId: string };
    const token = ctx.auth?.token ?? "";

    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const response = await certifyDossierControllerRun({
      client: sdkClient,
      path: { caseFileId, dossierId } as any,
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null
          ? JSON.stringify(response.error)
          : String(response.error);
      throw new Error(`dossier_certify error: ${msg}`);
    }

    return response.data ?? { certified: true, dossierId };
  },
});
