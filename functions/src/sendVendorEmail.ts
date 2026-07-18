/**
 * Phase 6 slice 2 — outbound vendor email from Resolve Issue flow.
 * Requires Gmail OAuth connected + refresh token in Admin-only storage.
 * No reply watch or inbound ingest.
 */
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  buildGmailRawMessage,
  containsCrlfInEmailHeader,
  getGmailMessageMetadata,
  gmailClientId,
  gmailClientSecret,
  refreshGmailAccessToken,
  sendGmailMessage,
} from "./gmailApi";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  assembleOutboundEmailBody,
  buildPlusReplyTo,
  generateTrackingToken,
} from "./email/trackingToken";

const PROVIDER_ID = "gmail";
const MAX_SUBJECT_LEN = 500;
const MAX_BODY_LEN = 12_000;
const MAX_EMAIL_LEN = 254;
const MAX_ID_LEN = 128;
const BODY_EXCERPT_LEN = 500;

function getDb() {
  return admin.firestore();
}

function connectionRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}

function secretsRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  if (containsCrlfInEmailHeader(trimmed)) return null;
  return trimmed;
}

function asEmail(value: unknown): string | null {
  const s = asNonEmptyString(value, MAX_EMAIL_LEN);
  if (!s || !s.includes("@")) return null;
  return s.toLowerCase();
}

function omitUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function bodyExcerpt(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= BODY_EXCERPT_LEN) return trimmed;
  return `${trimmed.slice(0, BODY_EXCERPT_LEN - 1)}…`;
}

interface SendVendorEmailRequest {
  deliveryOrderId?: string;
  vendorId?: string;
  materialIssueId?: string;
  to?: string;
  cc?: string[];
  subject?: string;
  body?: string;
  saveVendorEmail?: boolean;
  replyThreadId?: string;
  inReplyTo?: string;
  references?: string[];
}

const MAX_CC_RECIPIENTS = 5;
const MAX_MESSAGE_ID_LEN = 512;

function asEmailList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    const email = asEmail(item);
    if (email) out.push(email);
    if (out.length > MAX_CC_RECIPIENTS) break;
  }
  return [...new Set(out)];
}

function asMessageIdHeader(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MESSAGE_ID_LEN) return null;
  if (containsCrlfInEmailHeader(trimmed)) return null;
  return trimmed;
}

function asMessageIdList(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  const out: string[] = [];
  for (const item of values) {
    const id = asMessageIdHeader(item);
    if (id) out.push(id);
  }
  return out.length > 0 ? out : null;
}

export const sendVendorEmail = onCall(
  {
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret],
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const uid = await requireDispatcherAuth(request);

    const data = (request.data ?? {}) as SendVendorEmailRequest;
    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, MAX_ID_LEN);
    const vendorIdParam = data.vendorId
      ? asNonEmptyString(data.vendorId, MAX_ID_LEN)
      : null;
    const materialIssueId = data.materialIssueId
      ? asNonEmptyString(data.materialIssueId, MAX_ID_LEN)
      : null;
    const to = asEmail(data.to);
    const cc = asEmailList(data.cc);
    const subject = asNonEmptyString(data.subject, MAX_SUBJECT_LEN);
    const body = asNonEmptyString(data.body, MAX_BODY_LEN);
    const replyThreadId = asNonEmptyString(data.replyThreadId, MAX_ID_LEN);
    const inReplyTo = asMessageIdHeader(data.inReplyTo);
    const references = asMessageIdList(data.references);

    if (!to || !subject || !body) {
      throw new HttpsError(
        "invalid-argument",
        "to, subject, and body are required.",
      );
    }

    if (cc.includes(to)) {
      throw new HttpsError(
        "invalid-argument",
        "Cc must not duplicate the primary recipient.",
      );
    }

    const db = getDb();
    const connSnap = await connectionRef(db).get();
    if (!connSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Gmail is not connected. Connect in Settings first.",
      );
    }

    const conn = connSnap.data() as {
      status?: string;
      connectedAccountEmail?: string;
    };
    if (conn.status !== "connected") {
      throw new HttpsError(
        "failed-precondition",
        "Gmail is not connected. Connect in Settings first.",
      );
    }

    const fromEmail = conn.connectedAccountEmail?.trim();
    if (!fromEmail || containsCrlfInEmailHeader(fromEmail)) {
      throw new HttpsError(
        "failed-precondition",
        "Gmail connection is missing account email. Reconnect in Settings.",
      );
    }

    const secretSnap = await secretsRef(db).get();
    const refreshToken = secretSnap.exists
      ? (secretSnap.data() as { refreshToken?: string }).refreshToken?.trim()
      : undefined;
    if (!refreshToken) {
      throw new HttpsError(
        "failed-precondition",
        "Gmail refresh token missing. Reconnect in Settings.",
      );
    }

    const saveVendorEmail = data.saveVendorEmail === true;
    const isIssueContext = !!materialIssueId;
    let resolvedVendorId: string | undefined;
    let resolvedJobId: string | undefined;
    let resolvedPurchaseOrderId: string | undefined;
    let resolvedDeliveryOrderId: string | undefined;

    async function enforceVendorEmailMatch(
      vendorId: string,
      vendorEmailOnFile: string,
    ): Promise<void> {
      const vendorEmail = vendorEmailOnFile.trim().toLowerCase();
      if (vendorEmail && to !== vendorEmail) {
        if (!saveVendorEmail) {
          throw new HttpsError(
            "invalid-argument",
            "Recipient differs from vendor email on file. Confirm save to vendor record.",
          );
        }
      } else if (!vendorEmail && !saveVendorEmail) {
        throw new HttpsError(
          "invalid-argument",
          "Vendor has no email on file. Confirm save to vendor record.",
        );
      }
      if (saveVendorEmail && to !== vendorEmail) {
        await db.collection("vendors").doc(vendorId).set(
          {
            email: to,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      }
    }

    if (deliveryOrderId) {
      const deliverySnap = await db.collection("deliveries").doc(deliveryOrderId).get();
      if (!deliverySnap.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }

      const delivery = deliverySnap.data() as {
        vendorId?: string;
        jobId?: string;
        purchaseOrderId?: string;
      };

      if (!delivery.vendorId) {
        throw new HttpsError("failed-precondition", "Delivery has no vendor.");
      }

      const vendorSnap = await db.collection("vendors").doc(delivery.vendorId).get();
      if (!vendorSnap.exists) {
        throw new HttpsError("not-found", "Vendor not found.");
      }

      const vendor = vendorSnap.data() as { email?: string };
      if (isIssueContext) {
        await enforceVendorEmailMatch(
          delivery.vendorId,
          vendor.email?.trim() ?? "",
        );
      }

      if (materialIssueId) {
        const issueSnap = await db.collection("materialIssues").doc(materialIssueId).get();
        if (!issueSnap.exists) {
          throw new HttpsError("not-found", "Material issue not found.");
        }
        const issue = issueSnap.data() as { deliveryOrderId?: string };
        if (issue.deliveryOrderId !== deliveryOrderId) {
          throw new HttpsError(
            "invalid-argument",
            "Material issue does not belong to this delivery.",
          );
        }
      }

      resolvedVendorId = delivery.vendorId;
      resolvedJobId = delivery.jobId;
      resolvedPurchaseOrderId = delivery.purchaseOrderId;
      resolvedDeliveryOrderId = deliveryOrderId;
    } else if (vendorIdParam) {
      const vendorSnap = await db.collection("vendors").doc(vendorIdParam).get();
      if (!vendorSnap.exists) {
        throw new HttpsError("not-found", "Vendor not found.");
      }
      const vendor = vendorSnap.data() as { email?: string };
      await enforceVendorEmailMatch(vendorIdParam, vendor.email?.trim() ?? "");
      resolvedVendorId = vendorIdParam;
    }

    let accessToken: string;
    try {
      accessToken = await refreshGmailAccessToken(refreshToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("sendVendorEmail token refresh failed:", message);
      const now = new Date().toISOString();
      await connectionRef(db).set(
        {
          provider: PROVIDER_ID,
          status: "token_expired",
          updatedAt: now,
        },
        { merge: true },
      );
      throw new HttpsError(
        "failed-precondition",
        "Gmail token expired. Reconnect in Settings.",
      );
    }

    const trackingToken = generateTrackingToken();
    const bodyWithFooter = assembleOutboundEmailBody(body, trackingToken);
    const replyTo = buildPlusReplyTo(fromEmail, trackingToken);

    const raw = buildGmailRawMessage(to, fromEmail, subject, bodyWithFooter, {
      replyTo,
      fromDisplayName: "L. Garage Dispatch (StageVerify)",
      cc: cc.length > 0 ? cc : undefined,
      inReplyTo: inReplyTo ?? undefined,
      references: references ?? undefined,
    });
    let gmailResult: { id: string; threadId?: string };
    try {
      gmailResult = await sendGmailMessage(accessToken, raw, {
        threadId: replyThreadId ?? undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("sendVendorEmail gmail send failed:", message);
      throw new HttpsError(
        "internal",
        "Failed to send email. Check Gmail connection and try again.",
      );
    }

    let rfc822MessageId: string | undefined;
    try {
      const meta = await getGmailMessageMetadata(accessToken, gmailResult.id);
      rfc822MessageId = meta.rfc822MessageId;
      if (!gmailResult.threadId && meta.threadId) {
        gmailResult = { ...gmailResult, threadId: meta.threadId };
      }
    } catch (err) {
      console.warn(
        "sendVendorEmail: Message-ID metadata fetch failed (non-fatal):",
        err instanceof Error ? err.message : String(err),
      );
    }

    const now = new Date().toISOString();
    const eventId = `vee-${randomUUID()}`;
    const communicationPurpose = isIssueContext
      ? "need_more_information"
      : "general";
    const eventDoc = omitUndefined({
      id: eventId,
      sourceMessageId: gmailResult.id,
      threadId: gmailResult.threadId,
      rfc822MessageId,
      trackingToken,
      direction: "outbound",
      communicationPurpose,
      materialIssueId: materialIssueId ?? undefined,
      senderEmail: fromEmail,
      recipientEmails: [to, ...cc],
      replyToAddress: replyTo,
      subject,
      receivedAt: now,
      vendorId: resolvedVendorId,
      jobId: resolvedJobId,
      deliveryOrderId: resolvedDeliveryOrderId,
      purchaseOrderId: resolvedPurchaseOrderId,
      reviewStatus: "approved",
      sentBy: uid,
      sentAt: now,
      bodyExcerpt: bodyExcerpt(body),
      provider: PROVIDER_ID,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("vendorEmailEvents").doc(eventId).set(eventDoc);

    return {
      eventId,
      sourceMessageId: gmailResult.id,
      threadId: gmailResult.threadId ?? null,
      trackingToken,
      rfc822MessageId: rfc822MessageId ?? null,
      replyToAddress: replyTo,
      sentAt: now,
    };
  },
);
