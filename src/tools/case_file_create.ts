// Custom tool override: case_file_create — updated description with useCaseId default.
// Sourced from operation: CreateCaseFileController_run (POST /case-files)
// n8n-http: POST /case-files
//
// Copied verbatim by the generator (AC3 override mechanism).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { defineTool } from "../core/index.js";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { createCaseFileControllerRun } from "../api/sdk.gen.js";
import { zCreateCaseFileControllerRunBody } from "../api/zod.gen.js";
const inputSchema = z.object({
  ...zCreateCaseFileControllerRunBody.shape,
});

export const case_file_create = defineTool({
  name: "case_file_create",
  description:
    "Creates a new case file — the top-level container for all related operations (evidence, notifications, dossiers, chats). " +
    "Call this first before any other operation. Generate a UUID v4 for `id`. " +
    "For `useCaseId`, use the general GoCertius use case: `063a016a-1d62-4b7b-a24f-7cf4d1d289bf` unless a specific use case is required. " +
    "Returns caseFileId needed for all subsequent calls.",
  inputSchema,
  annotations: {
    destructive: false,
    idempotent: false,
    requiresUserConfirmation: false,
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
      const msg = typeof response.error === "object" && response.error !== null && "message" in response.error
        ? String(response.error.message)
        : JSON.stringify(response.error);
      throw new Error(msg);
    }
    return response.data;
  },
});
