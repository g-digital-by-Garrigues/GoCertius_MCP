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
import { defineTool, toolError } from "../core/index.js";

const inputSchema = z.object({
  ...zCreateNotificationCertificateControllerRunPath.shape,
  ...zCreateNotificationCertificateControllerRunBody.shape,
  embeddedDocuments:
    zCreateNotificationCertificateControllerRunBody.shape.embeddedDocuments.describe(
      "true embeds the notification's documents in the certificate (409 if the notification has none). " +
        "Fixed when the certificate is created: to change it, use a new id.",
    ),
});

export const notification_certificate_get = defineTool({
  name: "notification_certificate_get",
  description:
    "Creates or retrieves the delivery certificate for ONE receiver. Requires: " +
    "notification_request_send, notification_receiver_add → receiverId, notificationRequestId, " +
    "caseFileId. 403 while the notification is DRAFT or that receiver is still READY_TO_SEND " +
    "(see notification_receiver_list). Generate a UUID v4 for `id` once and reuse it when " +
    "polling: the tool returns the existing certificate with that id instead of creating a " +
    "duplicate. CERTIFYING → CERTIFIED; poll until CERTIFIED, when documentUrl is included. " +
    "partial: true means it was issued before the receiver READ (NO_RESPONSE type) or ANSWERED " +
    "(other types); for the final one, call again with a new id once it has.",
  inputSchema,
  annotations: {
    title: "Notification Certificate Get",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  pollable: false,
  // E22 22-16 review: 0, not 60. Agents poll this tool with the SAME arguments until CERTIFIED; a 60 s
  // result cache answered every poll with the first CERTIFYING result. The tool is idempotent by itself
  // (it looks the id up before creating), so the cache added nothing but stale answers.
  idempotencyWindowSeconds: 0,
  async execute(input, ctx) {
    const { caseFileId, notificationRequestId, receiverId, id, language, embeddedDocuments } =
      input as {
        caseFileId: string;
        notificationRequestId: string;
        receiverId: string;
        id: string;
        language?: "en_GB" | "es_ES";
        embeddedDocuments?: boolean;
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
    if (existing) {
      // E22 22-16 review: an existing id returns that certificate as it was created. Asking for other
      // options under the same id used to return it unchanged, with no error.
      const differs = [
        embeddedDocuments !== undefined &&
          typeof existing.embeddedDocuments === "boolean" &&
          existing.embeddedDocuments !== embeddedDocuments &&
          `embeddedDocuments=${String(existing.embeddedDocuments)}`,
        language !== undefined &&
          typeof existing.language === "string" &&
          existing.language !== language &&
          `language=${existing.language}`,
      ].filter(Boolean);
      if (differs.length > 0) {
        throw toolError({
          operation: "notification_certificate_get",
          upstream: new Error(
            `certificate ${id} already exists with ${differs.join(" and ")}; this id always returns it as it was created`,
          ),
          remediation:
            "Call again with a NEW id to create a certificate with the options you want, or with the same id and the same options to poll this one.",
        });
      }
      return await withDocumentUrl(sdkClient, path, existing, id);
    }

    const created = await createNotificationCertificateControllerRun({
      client: sdkClient,
      path,
      // E22 22-16: embeddedDocuments was accepted but never sent, so a certificate asked for with the
      // notification's documents embedded came back without them, and no error.
      body: {
        id,
        language,
        ...(embeddedDocuments === undefined ? {} : { embeddedDocuments }),
      } as any,
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
  // E22 22-16 review: every page, not only the first 50 certificates — a receiver can have more, and a
  // missed id made the tool POST a duplicate. Exact id match only: the caller mints the id, and every
  // listed certificate carries one (the spec makes `id` required), so an id-less item is never ours.
  const PAGE = 100;
  for (let number = 1; number <= 50; number++) {
    const response = await listNotificationCertificatesControllerRun({
      client: client as any,
      path,
      query: { page: { number, size: PAGE } } as any,
    });
    if (response.error !== undefined) throw new Error(errorMessage(response.error));
    const data =
      (response.data as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [];
    const found = data.find((cert) => cert.id === id);
    if (found || data.length < PAGE) return found;
  }
  return undefined;
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
