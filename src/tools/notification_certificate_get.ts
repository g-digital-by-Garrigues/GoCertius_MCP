// Custom override — idempotent notification certificate retrieval/creation.
// The generated tool always POSTs. The API returns an upstream error if a
// certificate with the same id already exists, so first list by receiver and
// return the existing certificate when present.
// Sourced from operation: CreateNotificationCertificateController_run (POST /case-files/{caseFileId}/notification-requests/{notificationRequestId}/receivers/{receiverId}/certificates)

import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import {
  createNotificationCertificateControllerRun,
  listNotificationCertificatesControllerRun,
  showNotificationCertificateDocumentUrlControllerRun,
} from "../api/sdk.gen.js";
import {
  zCreateNotificationCertificateControllerRunBody,
  zCreateNotificationCertificateControllerRunPath,
} from "../api/zod.gen.js";
import { defineTool } from "../core/index.js";

const inputSchema = z.object({
  ...zCreateNotificationCertificateControllerRunPath.shape,
  ...zCreateNotificationCertificateControllerRunBody.shape,
});

export const notification_certificate_get = defineTool({
  name: "notification_certificate_get",
  description:
    "Creates or retrieves a PDF certificate for a specific notification receiver. " +
    "Requires notification_request_send and notification_receiver_add. Generate a UUID v4 for `id` " +
    "the first time and reuse that id when polling. This tool is idempotent: it first lists existing " +
    "certificates for the receiver and, if `id` already exists, returns it instead of creating it again. " +
    "If the certificate status is CERTIFIED, the response includes documentUrl when available. " +
    "If it is CERTIFYING, poll this same tool with the same id.",
  inputSchema,
  annotations: {
    title: "Notification Certificate Get",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 60,
  async execute(input, ctx) {
    const { caseFileId, notificationRequestId, receiverId, id, language } = input as {
      caseFileId: string;
      notificationRequestId: string;
      receiverId: string;
      id: string;
      language?: "en_GB" | "es_ES";
    };
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

    const path = { caseFileId, notificationRequestId, receiverId };
    const existing = await findCertificate(sdkClient, path, id);
    if (existing) return await withDocumentUrl(sdkClient, path, existing, id);

    const created = await createNotificationCertificateControllerRun({
      client: sdkClient,
      path,
      body: { id, language } as any,
    });
    if (created.error !== undefined) {
      const afterError = await findCertificate(sdkClient, path, id);
      if (afterError) return await withDocumentUrl(sdkClient, path, afterError, id);
      throw new Error(errorMessage(created.error));
    }

    const afterCreate = await findCertificate(sdkClient, path, id);
    if (afterCreate) return await withDocumentUrl(sdkClient, path, afterCreate, id);
    return { id, status: "CERTIFYING" };
  },
});

async function findCertificate(
  client: unknown,
  path: { caseFileId: string; notificationRequestId: string; receiverId: string },
  id: string,
) {
  const response = await listNotificationCertificatesControllerRun({
    client: client as any,
    path,
    query: { page: { number: 1, size: 50 } } as any,
  });
  if (response.error !== undefined) throw new Error(errorMessage(response.error));
  const data = (response.data as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [];
  // Prefer exact id match. Also accept stubs with no id (generating state) to prevent
  // duplicate POST calls when the backend hasn't yet populated the id field.
  return data.find((cert) => !cert.id || cert.id === id);
}

async function withDocumentUrl(
  client: unknown,
  path: { caseFileId: string; notificationRequestId: string; receiverId: string },
  certificate: Record<string, unknown>,
  id: string,
) {
  if (certificate.status !== "CERTIFIED") return certificate;
  // Use the certificate's own id if available; fall back to our id.
  const certId = (certificate.id as string | undefined) ?? id;
  const urlResponse = await showNotificationCertificateDocumentUrlControllerRun({
    client: client as any,
    path: { ...path, certificateId: certId },
  });
  if (urlResponse.error === undefined && urlResponse.data) {
    return { ...certificate, ...(urlResponse.data as Record<string, unknown>) };
  }
  return certificate;
}

function errorMessage(error: unknown) {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : JSON.stringify(error);
}
