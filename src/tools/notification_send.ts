// Custom-only tool: notification_send — creates a certified notification, adds every recipient and
// sends it, in one call. No backing OpenAPI operation; registered via product.config customOnlyTools.
// Attachments are deliberately NOT handled here — see notification_send_with_attachments, which has
// to obey a stricter ordering rule (documents before recipients). Keeping the common path free of
// file handling is what lets it work in runtimes that cannot supply file bytes (STR-E19-05).
// Paths are relative to the emitted location: dist-repos/gocertius/src/tools/

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient, createConfig } from "../api/client/index.js";
import {
  createNotificationReceiverControllerRun,
  createNotificationRequestControllerRun,
  listNotificationReceiversControllerRun,
  sendNotificationRequestControllerRun,
} from "../api/sdk.gen.js";
import { defineTool, describeUpstreamError, upstreamFromSdkResponse } from "../core/index.js";

/**
 * The API accepts plain text, reports SENT, and then renders nothing on the recipient's landing
 * page — a silent, certified, unreadable delivery. Cheaper to catch here than to discover after
 * a legally-binding notification has gone out. Mirrors the supported tag set exactly.
 */
const SUPPORTED_HTML = /<(p|strong|em|ul|ol|li)\b[^>]*>/i;

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

interface AddedRecipient {
  receiverId: string;
  email: string;
}
interface FailedRecipient {
  email: string;
  error: string;
}

export const notification_send = defineTool({
  name: "notification_send",
  description:
    "Sends a certified notification to one or more recipients in a single call: creates the notification request, adds every recipient, and sends it. " +
    "Generates every UUID itself — do not pass any id. Requires case_file_create → caseFileId. " +
    "`content` MUST be HTML: plain text is accepted by the API and reports SENT but does not render on the recipient's landing page. Supported tags only: <p>, <strong>, <em>, <ul><li>, <ol><li> — no other tags, no CSS. Keep `subject` to plain ASCII, 100 characters maximum. " +
    "Delivery is always by email; per recipient you can additionally set sendWaUrl (WhatsApp), sendSmsUrl (RCS or SMS depending on the handset) and otpRequired (one-time code), each of which needs phonePrefix with the + and phoneNumber. " +
    "The maximum number of recipients is a per-subscription setting, not a fixed limit, so none is enforced here — the API rejects an oversized batch. " +
    "This tool does NOT attach files; use notification_send_with_attachments for that, because attachments must be registered before recipients are added. " +
    "PARTIAL SUCCESS IS REPORTED, NOT THROWN: if the request was created but a recipient or the send failed, the result still carries notificationRequestId together with recipientsAdded, recipientsFailed and sent:false, so you can finish with notification_receiver_add and notification_request_send instead of abandoning a draft. An INVALID recipient blocks the send, so this tool checks for one before sending and reports invalidRecipients rather than attempting a send that cannot succeed. If the initial create fails the tool raises an error instead: common causes are a caseFileId that does not exist, a subject over 100 characters, and an exhausted contracted notification plan, which no retry will fix. If that error is a timeout rather than a rejection, check notification_request_list before retrying — the request may have been created anyway. " +
    "Poll notification_request_status for delivery progress, then notification_certificate_get per recipient.",
  inputSchema,
  annotations: {
    title: "Notification Send",
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
      recipients,
      otpByDefault,
      sendWaUrlByDefault,
      sendSmsUrlByDefault,
    } = input as z.infer<typeof inputSchema>;

    // Checked before anything is created: a notification whose body does not render is worse
    // than one that was never sent, because it is certified as delivered.
    if (!SUPPORTED_HTML.test(content)) {
      return ctx.toolError({
        operation: "notification_send",
        upstream: "content is not HTML",
        remediation:
          "Wrap the body in HTML before sending — for example <p>Your text here.</p>. The API accepts plain text and reports SENT, but the recipient's landing page renders nothing. Supported tags: <p>, <strong>, <em>, <ul><li>, <ol><li>.",
      });
    }

    // No default host on purpose: this file is duplicated per product, and a copied literal would
    // point one product's traffic at another's API. mcp-core has carried no default since PR #88
    // and the server refuses to start without MCP_API_BASE_URL, so this is unreachable anyway.
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

    // THROWN, not handed to ctx.toolError. toolError returns a structured object, so
    // executeWithAuthRetry's isUnauthorizedError never sees it and a 401 loses its
    // refresh-and-retry; it also drops fieldErrors, which only mapUpstreamError renders.
    // Throwing routes through both — same contract as every generated tool.
    if (created.error !== undefined) {
      throw upstreamFromSdkResponse(created, "notification_send");
    }

    // One call per recipient rather than /receivers/massive: the bulk endpoint does not accept the
    // per-recipient otpRequired / sendWaUrl / sendSmsUrl flags this tool exposes, and a bulk failure
    // does not say which recipient caused it — which would make the partial report below useless.
    const recipientsAdded: AddedRecipient[] = [];
    const recipientsFailed: FailedRecipient[] = [];
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
          recipientsFailed.push({ email: r.email, error: describeUpstreamError(res.error) });
        } else {
          recipientsAdded.push({ receiverId, email: r.email });
        }
      } catch (err) {
        recipientsFailed.push({ email: r.email, error: describeUpstreamError(err) });
      }
    }

    // Sending to nobody would burn the request for no result. Hand the draft back instead.
    if (recipientsAdded.length === 0) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        recipientsAdded,
        recipientsFailed,
        sent: false,
        nextSteps:
          "No recipient could be added, so the notification was NOT sent and is sitting in DRAFT. Fix the addresses and add them with notification_receiver_add (same notificationRequestId), then call notification_request_send. Or delete the draft with notification_request_delete.",
      };
    }

    // The live run + Hugo (2026-09-05) established that an INVALID recipient BLOCKS the send.
    // Checking here costs one GET and turns a guaranteed, opaque send failure into an actionable
    // partial result — without it the nextSteps below would tell the caller to retry a send that
    // cannot succeed until the bad addresses are gone.
    // biome-ignore lint/suspicious/noExplicitAny: generated SDK function — types validated at generation time
    const listReceivers = listNotificationReceiversControllerRun as (opts: any) => Promise<any>;
    const listed = await listReceivers({
      client: sdkClient,
      path: { caseFileId, notificationRequestId },
    });
    const invalidEmails: string[] = Array.isArray((listed?.data as { data?: unknown })?.data)
      ? ((listed.data as { data: Array<Record<string, unknown>> }).data
          .filter((r) => r.status === "INVALID")
          .map((r) => String(r.email ?? r.id)) as string[])
      : [];
    if (invalidEmails.length > 0) {
      return {
        notificationRequestId,
        caseFileId,
        created: true,
        recipientsAdded,
        recipientsFailed,
        invalidRecipients: invalidEmails,
        sent: false,
        nextSteps: `The API accepted these recipients but then marked them INVALID, and an INVALID recipient BLOCKS the send, so nothing was sent. Remove them with notification_receiver_invalid_purge, or correct the addresses with notification_receiver_update, then call notification_request_send on this notificationRequestId. Affected: ${invalidEmails.join(", ")}.`,
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
        recipientsAdded,
        recipientsFailed,
        sent: false,
        sendError: describeUpstreamError(sent.error),
        nextSteps:
          "Recipients were added but the send failed. The notification is in DRAFT with its recipients intact. Before retrying blindly, call notification_receiver_list — an INVALID recipient blocks the send and no retry will clear it; remove them with notification_receiver_invalid_purge or fix the address with notification_receiver_update. Then call notification_request_send with the notificationRequestId above rather than creating a new notification.",
      };
    }

    return {
      notificationRequestId,
      caseFileId,
      created: true,
      recipientsAdded,
      recipientsFailed,
      sent: true,
      nextSteps:
        recipientsFailed.length > 0
          ? "Sent, but some recipients could not be added — see recipientsFailed. They did NOT receive it; add them with notification_receiver_add and send a separate notification if they still need one. Poll notification_request_status for delivery progress."
          : "Poll notification_request_status until the status is SENT or beyond, then call notification_certificate_get per receiverId for the delivery certificates.",
    };
  },
});
