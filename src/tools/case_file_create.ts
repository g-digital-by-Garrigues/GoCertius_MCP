// Custom tool override: case_file_create — updated description with useCaseId default.
// Sourced from operation: CreateCaseFileController_run (POST /case-files)
// n8n-http: POST /case-files
//
// Copied verbatim by the generator (AC3 override mechanism).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { createCaseFileControllerRun } from "../api/sdk.gen.js";
import { zCreateCaseFileControllerRunBody } from "../api/zod.gen.js";
import { defineTool } from "../core/index.js";

const inputSchema = z.object({
  ...zCreateCaseFileControllerRunBody.shape,
});

export const case_file_create = defineTool({
  name: "case_file_create",
  description:
    "Creates a case file, the top-level container for evidence, signatures, notifications, " +
    "dossiers and chats. Generate a UUID v4 for `id`: the API returns no body, so that `id` IS the caseFileId " +
    "later calls need. For `useCaseId` use the General use case " +
    "`063a016a-1d62-4b7b-a24f-7cf4d1d289bf` unless a specific one is required; it must be " +
    "enabled for your company.",
  inputSchema,
  annotations: {
    title: "Case File Create",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(input, ctx) {
    const token = ctx.auth?.token ?? "";
    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(ctx.correlationId ? { "X-Correlation-Id": ctx.correlationId } : {}),
        },
      }),
    );

    // biome-ignore lint/suspicious/noExplicitAny: generated SDK call — input shape validated above
    const inp = input as any;
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const sdkFn = createCaseFileControllerRun as (opts: any) => Promise<any>;
    const response = await sdkFn({
      client: sdkClient,
      body: zCreateCaseFileControllerRunBody.parse(inp),
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null && "message" in response.error
          ? String(response.error.message)
          : JSON.stringify(response.error);
      throw new Error(msg);
    }
    return response.data;
  },
});
