// Custom override — sets pollable:false so standard callTool clients (Claude Code, n8n) work.
// Auto-generated version has pollable:true which requires taskSupport capability.
// Sourced from operation: CloseEvidenceGroupController_run (POST /case-files/{caseFileId}/evidence-groups/{id}/close)

import { defineTool } from "../core/index.js";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { closeEvidenceGroupControllerRun } from "../api/sdk.gen.js";
import { zCloseEvidenceGroupControllerRunPath } from "../api/zod.gen.js";
import { zCloseEvidenceGroupControllerRunBody } from "../api/zod.gen.js";
const inputSchema = z.object({
  ...zCloseEvidenceGroupControllerRunPath.shape,
  ...zCloseEvidenceGroupControllerRunBody.shape,
});

export const evidence_seal = defineTool({
  name: "evidence_seal",
  description: "Seal and certify an evidence group. Closes the group to new additions and triggers async timestamping. Returns immediately — the group transitions OPEN → CLOSING → CLOSED. Poll evidence_group_list until status is CLOSED before linking to a dossier.",
  inputSchema,
  annotations: {
    destructive: false,
    idempotent: false,
    requiresUserConfirmation: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 86400,
  async execute(input, ctx) {
    const token = ctx.auth?.token ?? "";
    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(ctx.correlationId ? { "X-Correlation-Id": ctx.correlationId } : {}),
        },
      }),
    );

    // biome-ignore lint/suspicious/noExplicitAny: generated SDK call — input shape validated above
    const inp = input as any;
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const sdkFn = closeEvidenceGroupControllerRun as (opts: any) => Promise<any>;
    const response = await sdkFn({
      client: sdkClient,
      path: zCloseEvidenceGroupControllerRunPath.parse(inp),
      body: zCloseEvidenceGroupControllerRunBody.parse(inp),
    });

    if (response.error !== undefined) {
      const msg = typeof response.error === "object" && response.error !== null && "message" in response.error
        ? String(response.error.message)
        : JSON.stringify(response.error);
      throw new Error(msg);
    }
    return response.data;
  },
});
