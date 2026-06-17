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
    "Certifies a DRAFT dossier, locking in all its associated evidence groups. " +
    "The dossier must be in DRAFT status. After certification it transitions to CERTIFIED " +
    "and a tamper-evident PDF is generated. " +
    "Prerequisites: the dossier must exist (dossier_create) and have evidence groups linked. " +
    "Use dossier_group_certify instead if you want to create + certify in one step from a single evidence group. " +
    "Example: dossier_certify({ caseFileId: '...', dossierId: '...' })",
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
