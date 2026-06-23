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
  gmailClientId,
  gmailClientSecret,
  refreshGmailAccessToken,
  sendGmailMessage,
} from "./gmailApi";

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
  materialIssueId?: string;
  to?: string;
  subject?: string;
  body?: string;
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
    if (!request.auth?.uid) {
      throw new HttpsError(
        "permission-denied",
        "Sign in as a dispatcher to send vendor email.",
      );
    }

    const data = (request.data ?? {}) as SendVendorEmailRequest;
    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, MAX_ID_LEN);
    const materialIssueId = data.materialIssueId
      ? asNonEmptyString(data.materialIssueId, MAX_ID_LEN)
      : null;
    const to = asEmail(data.to);
    const subject = asNonEmptyString(data.subject, MAX_SUBJECT_LEN);
    const body = asNonEmptyString(data.body, MAX_BODY_LEN);

    if (!deliveryOrderId || !to || !subject || !body) {
      throw new HttpsError(
        "invalid-argument",
        "deliveryOrderId, to, subject, and body are required.",
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
    const vendorEmail = vendor.email?.trim().toLowerCase();
    if (!vendorEmail) {
      throw new HttpsError(
        "failed-precondition",
        "Vendor has no email on file.",
      );
    }
    if (to !== vendorEmail) {
      throw new HttpsError(
        "invalid-argument",
        "Recipient must match vendor email on file.",
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

    const raw = buildGmailRawMessage(to, fromEmail, subject, body);
    let gmailResult: { id: string; threadId?: string };
    try {
      gmailResult = await sendGmailMessage(accessToken, raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("sendVendorEmail gmail send failed:", message);
      throw new HttpsError(
        "internal",
        "Failed to send email. Check Gmail connection and try again.",
      );
    }

    const now = new Date().toISOString();
    const eventId = `vee-${randomUUID()}`;
    const eventDoc = omitUndefined({
      id: eventId,
      sourceMessageId: gmailResult.id,
      threadId: gmailResult.threadId,
      direction: "outbound",
      communicationPurpose: "need_more_information",
      materialIssueId: materialIssueId ?? undefined,
      senderEmail: fromEmail,
      recipientEmails: [to],
      subject,
      receivedAt: now,
      vendorId: delivery.vendorId,
      jobId: delivery.jobId,
      deliveryOrderId,
      purchaseOrderId: delivery.purchaseOrderId,
      reviewStatus: "approved",
      sentBy: request.auth.uid,
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
      sentAt: now,
    };
  },
);
