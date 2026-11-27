// Custom override — sets pollable:false so standard callTool clients (Claude Code, n8n) work.
// Auto-generated version has pollable:true which requires taskSupport capability.
// Sourced from operation: SendNotificationRequestController_run (PUT /case-files/{caseFileId}/notification-requests/{notificationRequestId}/send)

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { sendNotificationRequestControllerRun } from "../api/sdk.gen.js";
import { zSendNotificationRequestControllerRunPath } from "../api/zod.gen.js";
import { defineTool } from "../core/index.js";

const inputSchema = z.object({
  ...zSendNotificationRequestControllerRunPath.shape,
});

export const notification_request_send = defineTool({
  name: "notification_request_send",
  description:
    "Sends a DRAFT certified notification to its receivers. Requires: " +
    "notification_request_create → notificationRequestId, caseFileId and at least one receiver " +
    "(notification_receiver_add). 403 if it is not DRAFT; 409 if no receiver is READY_TO_SEND, " +
    "any is INVALID (see notification_receiver_invalid_purge) or the plan's receiver or document " +
    "cap is exceeded. ASYNC: the status becomes IN_PROCESS; poll notification_request_status " +
    "until SENT or beyond before calling notification_certificate_get.",
  inputSchema,
  annotations: {
    title: "Notification Request Send",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 86400,
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
    const sdkFn = sendNotificationRequestControllerRun as (opts: any) => Promise<any>;
    const response = await sdkFn({
      client: sdkClient,
      path: zSendNotificationRequestControllerRunPath.parse(inp),
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
