// Custom-only tool: notification_send_with_attachments — creates a certified notification, attaches
// one or more documents, adds every recipient and sends it, in one call.
//
// Separate from notification_send on purpose. The API imposes an ordering rule that only applies
// when documents are involved (tested, api-skills/gocertius-suite-api/SKILL.md §6): documents must
// be registered BEFORE recipients are added, and every document must reach READY_TO_SEND before
// /send, or the call fails with 409/404 NOTIFICATION_NOT_FOUND. Folding that into the common path
// would make the simple case carry the constraints of the rare one (STR-E19-06).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import {
  createNotificationDocumentControllerRun,
  createNotificationReceiverControllerRun,
  createNotificationRequestControllerRun,
  listNotificationDocumentsControllerRun,
  listNotificationReceiversControllerRun,
  sendNotificationRequestControllerRun,
} from "../api/sdk.gen.js";
import {
  defineTool,
  describeUpstreamError,
  FileInput,
  upstreamFromSdkResponse,
} from "../core/index.js";

/** Same guard as notification_send: plain text is accepted, reported SENT, and renders nothing. */
const SUPPORTED_HTML = /<(p|strong|em|ul|ol|li)\b[^>]*>/i;

/** Documented transition is ~8 s; 15 tries at 2 s leaves generous headroom without hanging a call. */
const DOC_POLL_INTERVAL_MS = 2_000;
const DOC_POLL_MAX_ATTEMPTS = 15;

const attachmentSchema = z.object({
  file: FileInput,
  fileName: z
    .string()
    .optional()
    .describe("Name to register the document under. Defaults to the resolved file's own name."),
});

const recipientSchema = z.object({
  firstName: z.string().min(1).describe("Recipient's first name"),
  lastName: z.string().min(1).describe("Recipient's last name or names"),
  email: z.string().email().describe("Recipient's email address — delivery always goes by email"),
  phonePrefix: z
    .string()
    .optional()
    .describe(
      "International dialling prefix INCLUDING the + (e.g. '+34'). Required with any of sendWaUrl, sendSmsUrl or otpRequired.",
    ),
  phoneNumber: z
    .string()
    .optional()
    .describe(
      "Phone number without the prefix. Required with any of sendWaUrl, sendSmsUrl or otpRequired.",
    ),
  otpRequired: z
    .boolean()
    .optional()
    .describe(
      "Challenge this recipient with a one-time code before they can read the notification",
    ),
  sendWaUrl: z.boolean().optional().describe("Also send this recipient the link over WhatsApp"),
  sendSmsUrl: z
    .boolean()
    .optional()
    .describe(
      "Also send this recipient the link over RCS or SMS, whichever their handset supports",
    ),
});

const inputSchema = z.object({
  caseFileId: z.string().uuid().describe("UUID of the case file the notification belongs to"),
  subject: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "Subject line, 100 characters maximum. Use plain ASCII — avoid em dashes and smart quotes.",
    ),
  content: z
    .string()
    .min(1)
    .describe(
      "Body of the notification as HTML. Supported tags only: <p>, <strong>, <em>, <ul><li>, <ol><li>. No other tags and no CSS. Plain text is accepted by the API but does NOT render for the recipient.",
    ),
  language: z
    .enum(["en_GB", "es_ES"])
    .describe("Language of the notification and its landing page"),
  type: z
    .enum(["NO_RESPONSE", "ACCEPTED_OR_NOT", "RECEIVED_AGREE"])
    .default("NO_RESPONSE")
    .describe(
      "What the recipient can do: NO_RESPONSE = read only; ACCEPTED_OR_NOT = accept or reject; RECEIVED_AGREE = acknowledge receipt and agree or disagree",
    ),
  attachments: z
    .array(attachmentSchema)
    .min(1)
    .describe(
      "One or more documents to attach. Each takes a local path, base64 content, an HTTPS URL or an n8n binary reference. The maximum is a per-subscription setting that varies by tenant and platform, so no limit is enforced here. With no attachments, use notification_send instead.",
    ),
  recipients: z
    .array(recipientSchema)
    .min(1)
    .describe(
      "One or more recipients. The maximum is a per-subscription setting that varies by tenant and platform, so no limit is enforced here — if the tenant's cap is exceeded the API says so.",
    ),
  otpByDefault: z
    .boolean()
    .optional()
    .describe(
      "Require a one-time code for every recipient that does not state its own otpRequired",
    ),
  sendWaUrlByDefault: z
    .boolean()
    .optional()
    .describe("Send the WhatsApp link to every recipient that does not state its own sendWaUrl"),
  sendSmsUrlByDefault: z
    .boolean()
    .optional()
    .describe("Send the RCS/SMS link to every recipient that does not state its own sendSmsUrl"),
});

interface AddedDocument {
  documentId: string;
  fileName: string;
  sha256: string;
  size: number;
}
interface FailedItem {
  label: string;
  error: string;
}
interface AddedRecipient {
  receiverId: string;
  email: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The spec declares NO response body for ListNotificationDocumentsController_run, so the emitted
 * output schema is unconstrained and the real shape is not promised anywhere. Read it defensively:
 * find any array of objects carrying a `status`, and treat "no statuses found" as "not ready yet"
 * rather than as "ready" — guessing optimistically here buys a 409 from /send.
 */
function documentStatuses(payload: unknown): string[] {
  const root = payload as { data?: unknown } | undefined;
  const list = Array.isArray(root?.data) ? root.data : Array.isArray(payload) ? payload : [];
  return list
    .map((d) =>
      typeof d === "object" && d !== null ? (d as { status?: unknown }).status : undefined,
    )
    .filter((s): s is string => typeof s === "string");
}

export const notification_send_with_attachments = defineTool({
  name: "notification_send_with_attachments",
  description:
    "Sends a certified notification WITH one or more attached documents to one or more recipients, in a single call. " +
    "Use notification_send instead when there are no attachments. " +
    "This tool exists separately because attachments impose an ordering rule the API enforces and does not forgive: documents must be registered and fully uploaded BEFORE any recipient is added, and every document must reach READY_TO_SEND before the notification is sent — otherwise the send fails with 409/404 NOTIFICATION_NOT_FOUND. The tool performs that whole sequence for you: create → register and upload each document → wait for READY_TO_SEND → add recipients → send. " +
    "Each attachment takes a local file path, base64 content, an HTTPS URL, or an n8n binary reference; the hash and the upload are handled internally. " +
    "Generates every UUID itself — do not pass any id. Requires case_file_create → caseFileId. " +
    "`content` MUST be HTML: plain text is accepted by the API and reports SENT but does not render on the recipient's landing page. Supported tags only: <p>, <strong>, <em>, <ul><li>, <ol><li>. Keep `subject` to plain ASCII, 100 characters maximum. " +
    "Delivery is always by email; per recipient you can additionally set sendWaUrl (WhatsApp), sendSmsUrl (RCS or SMS depending on the handset) and otpRequired (one-time code), each of which needs phonePrefix with the + and phoneNumber. " +
    "The maximum number of attachments and of recipients are per-subscription settings, not fixed limits, so neither is enforced here. " +
    "IF AN ATTACHMENT FAILS THE RUN STOPS BEFORE RECIPIENTS ARE ADDED, on purpose: once recipients exist the API will not accept further documents, so continuing would produce a notification that can never carry the missing file. The result reports the draft's notificationRequestId so you can retry or delete it. An INVALID recipient blocks the send, so the tool checks for one before sending and reports invalidRecipients instead of attempting a doomed send. If the initial create fails the tool raises an error instead: common causes are a caseFileId that does not exist, a subject over 100 characters, and an exhausted contracted notification plan, which no retry will fix. If that error is a timeout rather than a rejection, check notification_request_list before retrying — the request may have been created anyway. " +
    "Certificates can bundle the attachments — see notification_certificate_package_url.",
  inputSchema,
  annotations: {
    title: "Notification Send With Attachments",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  pollable: false,
  idempotencyWindowSeconds: 86400,
  async execute(input, ctx) {
    const {
      caseFileId,
      subject,
      content,
      language,
      type,
      attachments,
      recipients,
      otpByDefault,
      sendWaUrlByDefault,
      sendSmsUrlByDefault,
    } = input as z.infer<typeof inputSchema>;

    if (!SUPPORTED_HTML.test(content)) {
      return ctx.toolError({
        operation: "notification_send_with_attachments",
        upstream: "content is not HTML",
        remediation:
          "Wrap the body in HTML before sending — for example <p>Your text here.</p>. The API accepts plain text and reports SENT, but the recipient's landing page renders nothing. Supported tags: <p>, <strong>, <em>, <ul><li>, <ol><li>.",
      });
    }

    // No default host: this file is duplicated per product and a copied literal would point one
    // product's traffic at another's API. The server refuses to start without MCP_API_BASE_URL.
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

    const notificationRequestId = randomUUID();

    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const createRequest = createNotificationRequestControllerRun as (opts: any) => Promise<any>;
    const created = await createRequest({
      client: sdkClient,
      path: { caseFileId },
      body: {
        id: notificationRequestId,
        subject,
        content,
        language,
        type,
        ...(otpByDefault !== undefined ? { otpByDefault } : {}),
        ...(sendWaUrlByDefault !== undefined ? { sendWaUrlByDefault } : {}),
        ...(sendSmsUrlByDefault !== undefined ? { sendSmsUrlByDefault } : {}),
      },
    });
    // THROWN, not handed to ctx.toolError: toolError returns a structured object, so
    // executeWithAuthRetry's isUnauthorizedError never sees it and a 401 loses its
    // refresh-and-retry, and it drops fieldErrors that only mapUpstreamError renders.
    if (created.error !== undefined) {
      throw upstreamFromSdkResponse(created, "notification_send_with_attachments");
    }

    // ── Documents FIRST. Adding a recipient before this point makes the API refuse the document. ──
    const attachmentsAdded: AddedDocument[] = [];
    const attachmentsFailed: FailedItem[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const createDocument = createNotificationDocumentControllerRun as (opts: any) => Promise<any>;

    for (const item of attachments) {
      const label = item.fileName ?? "(attachment)";
      try {
        // ctx.files.resolve applies the shared SSRF / path-traversal / size guards and returns the
        // digest in both encodings — hex for the API's `hash`, base64 for x-amz-checksum-sha256.
        const resolved = await ctx.files.resolve(item.file);
        const fileName = item.fileName ?? resolved.filename;
        const documentId = randomUUID();

        const reg = await createDocument({
          client: sdkClient,
          path: { caseFileId, notificationRequestId },
          body: { id: documentId, fileName, hash: resolved.sha256, fileSize: resolved.size },
        });
        if (reg.error !== undefined) {
          attachmentsFailed.push({ label: fileName, error: describeUpstreamError(reg.error) });
          continue;
        }
        const uploadUrl = (reg.data as { url?: string } | undefined)?.url;
        if (!uploadUrl) {
          attachmentsFailed.push({ label: fileName, error: "API did not return an upload url" });
          continue;
        }

        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": resolved.contentType,
            "x-amz-checksum-sha256": resolved.sha256Base64,
          },
          body: new Uint8Array(resolved.bytes),
          signal: AbortSignal.timeout(120_000),
        });
        if (!put.ok) {
          attachmentsFailed.push({ label: fileName, error: `upload failed (HTTP ${put.status})` });
          continue;
        }

        attachmentsAdded.push({
          documentId,
          fileName,
          sha256: resolved.sha256,
          size: resolved.size,
        });
      } catch (err) {
        attachmentsFailed.push({ label, error: describeUpstreamError(err) });
      }
    }

    // Stop here rather than push on. Once a recipient exists the API will not accept another
    // document, so continuing would create a notification that can NEVER carry the missing file —
    // unrecoverable, where stopping is merely incomplete.
    if (attachmentsFailed.length > 0) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        attachmentsAdded,
        attachmentsFailed,
        recipientsAdded: [],
        sent: false,
        nextSteps:
          "One or more attachments failed, so NO recipients were added and nothing was sent — deliberately. The API refuses new documents once recipients exist, so adding them would have made the missing attachment impossible to add later. The draft is intact: retry the failed files with notification_document_add on this notificationRequestId (then notification_receiver_add and notification_request_send), or discard it with notification_request_delete.",
      };
    }

    // ── Wait for every document to leave PENDING. /send before that returns 409/404. ──
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const listDocuments = listNotificationDocumentsControllerRun as (opts: any) => Promise<any>;
    let documentsReady = false;
    for (let attempt = 0; attempt < DOC_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(DOC_POLL_INTERVAL_MS);
      const listed = await listDocuments({
        client: sdkClient,
        path: { caseFileId, notificationRequestId },
      });
      if (listed.error !== undefined) continue;
      const statuses = documentStatuses(listed.data);
      if (
        statuses.length >= attachmentsAdded.length &&
        statuses.every((s) => s === "READY_TO_SEND")
      ) {
        documentsReady = true;
        break;
      }
    }

    if (!documentsReady) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        attachmentsAdded,
        attachmentsFailed,
        recipientsAdded: [],
        sent: false,
        nextSteps: `Every attachment uploaded, but not all of them reached READY_TO_SEND within ${(DOC_POLL_INTERVAL_MS * DOC_POLL_MAX_ATTEMPTS) / 1000}s. No recipients were added and nothing was sent, because sending with a PENDING document fails with 409/404. Check notification_document_list on this notificationRequestId; once every document is READY_TO_SEND, add recipients with notification_receiver_add and call notification_request_send.`,
      };
    }

    // ── Recipients, then send — same contract as notification_send. ──
    const recipientsAdded: AddedRecipient[] = [];
    const recipientsFailed: FailedItem[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const createReceiver = createNotificationReceiverControllerRun as (opts: any) => Promise<any>;

    for (const r of recipients) {
      const receiverId = randomUUID();
      try {
        const res = await createReceiver({
          client: sdkClient,
          path: { caseFileId, notificationRequestId },
          body: {
            id: receiverId,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            ...(r.phonePrefix !== undefined ? { phonePrefix: r.phonePrefix } : {}),
            ...(r.phoneNumber !== undefined ? { phoneNumber: r.phoneNumber } : {}),
            ...(r.otpRequired !== undefined ? { otpRequired: r.otpRequired } : {}),
            ...(r.sendWaUrl !== undefined ? { sendWaUrl: r.sendWaUrl } : {}),
            ...(r.sendSmsUrl !== undefined ? { sendSmsUrl: r.sendSmsUrl } : {}),
          },
        });
        if (res.error !== undefined) {
          recipientsFailed.push({ label: r.email, error: describeUpstreamError(res.error) });
        } else {
          recipientsAdded.push({ receiverId, email: r.email });
        }
      } catch (err) {
        recipientsFailed.push({ label: r.email, error: describeUpstreamError(err) });
      }
    }

    if (recipientsAdded.length === 0) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        attachmentsAdded,
        attachmentsFailed,
        recipientsAdded,
        recipientsFailed,
        sent: false,
        nextSteps:
          "The attachments are in place but no recipient could be added, so the notification was NOT sent and is sitting in DRAFT. Fix the addresses and add them with notification_receiver_add on this notificationRequestId, then call notification_request_send. Do NOT re-upload the attachments — they are already registered.",
      };
    }

    // The live run + Hugo (2026-09-05) established that an INVALID recipient BLOCKS the send.
    // One GET turns a guaranteed, opaque send failure into an actionable partial result.
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const listReceivers = listNotificationReceiversControllerRun as (opts: any) => Promise<any>;
    const listedReceivers = await listReceivers({
      client: sdkClient,
      path: { caseFileId, notificationRequestId },
    });
    const invalidEmails: string[] = Array.isArray(
      (listedReceivers?.data as { data?: unknown })?.data,
    )
      ? (listedReceivers.data as { data: Array<Record<string, unknown>> }).data
          .filter((r) => r.status === "INVALID")
          .map((r) => String(r.email ?? r.id))
      : [];
    if (invalidEmails.length > 0) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        attachmentsAdded,
        recipientsAdded,
        recipientsFailed,
        invalidRecipients: invalidEmails,
        sent: false,
        nextSteps: `The API accepted these recipients but then marked them INVALID, and an INVALID recipient BLOCKS the send, so nothing was sent. The attachments are already in place and stay valid. Remove the bad addresses with notification_receiver_invalid_purge, or correct them with notification_receiver_update, then call notification_request_send on this notificationRequestId. Affected: ${invalidEmails.join(", ")}.`,
      };
    }
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const sendRequest = sendNotificationRequestControllerRun as (opts: any) => Promise<any>;
    const sent = await sendRequest({
      client: sdkClient,
      path: { caseFileId, notificationRequestId },
    });

    if (sent.error !== undefined) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        attachmentsAdded,
        recipientsAdded,
        recipientsFailed,
        sent: false,
        sendError: describeUpstreamError(sent.error),
        nextSteps:
          "Attachments and recipients are in place but the send failed. The notification is in DRAFT and intact. Before retrying blindly, call notification_receiver_list — an INVALID recipient blocks the send and no retry will clear it; remove them with notification_receiver_invalid_purge or fix the address with notification_receiver_update. Then call notification_request_send with the notificationRequestId above, and do not re-upload the attachments.",
      };
    }

    return {
      notificationRequestId,
      caseFileId,
      created: true,
      attachmentsAdded,
      recipientsAdded,
      recipientsFailed,
      sent: true,
      nextSteps:
        recipientsFailed.length > 0
          ? "Sent, but some recipients could not be added — see recipientsFailed. They did NOT receive it. Poll notification_request_status for delivery progress."
          : "Poll notification_request_status until the status is SENT or beyond, then call notification_certificate_get per receiverId. Use notification_certificate_package_url for a ZIP that bundles the attachments, or notification_certificate_document_url for the certificate alone.",
    };
  },
});
