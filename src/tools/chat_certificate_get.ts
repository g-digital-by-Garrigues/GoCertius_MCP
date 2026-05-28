// Custom tool: chat_certificate_get — spec bug workaround: ShowChatCertificateController_run
// omits caseFileId from path params even though the URL requires it.
// n8n-http: GET /case-files/{caseFileId}/chats/{chatId}/certificates/{id}
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import { showChatCertificateControllerRun, showChatCertificateDocumentUrlControllerRun } from "../api/sdk.gen.js";
import { defineTool } from "../core/index.js";

export const chat_certificate_get = defineTool({
  name: "chat_certificate_get",
  description:
    "Retrieves a certified chat certificate including its status, message range, and PDF download URL. " +
    "Prerequisites: the certificate must have been created with chat_certificate_create. " +
    "Returns documentUrl when status is CERTIFIED. " +
    "Example: chat_certificate_get({ caseFileId: '...', chatId: '...', id: '...' })",
  inputSchema: z.object({
    caseFileId: z.string().describe("UUID of the case file that owns the chat"),
    chatId: z.string().describe("UUID of the chat"),
    id: z.string().describe("UUID of the certificate to retrieve"),
  }),
  annotations: { destructive: false, idempotent: true, requiresUserConfirmation: false },
  pollable: false,
  idempotencyWindowSeconds: 30,
  async execute(input, ctx) {
    const { caseFileId, chatId, id } = input as { caseFileId: string; chatId: string; id: string };
    const token = ctx.auth?.token ?? "";

    const sdkClient = createClient(
      createConfig({
        baseUrl: process.env.MCP_API_BASE_URL ?? "https://api-gocertius.gocertius.io",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const response = await showChatCertificateControllerRun({
      client: sdkClient,
      path: { caseFileId, chatId, id } as any,
    });

    if (response.error !== undefined) {
      const msg =
        typeof response.error === "object" && response.error !== null
          ? JSON.stringify(response.error)
          : String(response.error);
      throw new Error(`chat_certificate_get error: ${msg}`);
    }

    const cert = response.data as Record<string, unknown>;

    // Fetch the document URL when the certificate is ready
    if (cert?.status === "CERTIFIED") {
      const urlResponse = await showChatCertificateDocumentUrlControllerRun({
        client: sdkClient,
        path: { caseFileId, chatId, chatCertificateId: id } as any,
      });
      if (urlResponse.error === undefined && urlResponse.data) {
        return { ...cert, documentUrl: (urlResponse.data as Record<string, unknown>).documentUrl };
      }
    }

    return cert;
  },
});
