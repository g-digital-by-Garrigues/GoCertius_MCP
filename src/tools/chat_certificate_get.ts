// Custom tool: chat_certificate_get — spec bug workaround: ShowChatCertificateController_run
// omits caseFileId from path params even though the URL requires it.
// n8n-http: GET /case-files/{caseFileId}/chats/{chatId}/certificates/{id}
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import {
  showChatCertificateControllerRun,
  showChatCertificateDocumentUrlControllerRun,
} from "../api/sdk.gen.js";
import { defineTool } from "../core/index.js";

export const chat_certificate_get = defineTool({
  name: "chat_certificate_get",
  description:
    "Retrieves a chat certificate: status, code, name, the certified message range " +
    "(chatMessagesFrom/To), validity dates and certifiedAt. Requires: chat_certificate_create → " +
    "id, chatId and the chat's caseFileId. CERTIFYING → CERTIFIED, or back to DRAFT if " +
    "certification fails (then create a new one with chat_certificate_create); poll this tool " +
    "until CERTIFIED or DRAFT. When CERTIFIED the response also carries documentUrl.",
  inputSchema: z.object({
    caseFileId: z.string().describe("UUID of the case file that owns the chat"),
    chatId: z.string().describe("UUID of the chat"),
    id: z.string().describe("UUID of the certificate to retrieve"),
  }),
  annotations: {
    title: "Chat Certificate Get",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  // E22 22-16 review: 0, not 30 — agents poll this tool with the same arguments; a cached answer
  // repeated the first CERTIFYING status for 30 s.
  idempotencyWindowSeconds: 0,
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
