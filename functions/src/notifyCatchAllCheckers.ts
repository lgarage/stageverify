/**
 * Phase 6 Slice C (D-44) — dispatcher catch-all delivery alert email.
 * Append-only catchAllNotifyLog + 15-min shop cooldown; Notify ≠ Arrived.
 */
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  buildGmailRawMessage,
  gmailClientId,
  gmailClientSecret,
  refreshGmailAccessToken,
  sendGmailMessage,
} from "./gmailApi";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { incrementCatchAllPendingCount } from "./catchAllPendingCount";
import { loadCatchAllConfig } from "./managementSessionValidation";

const PROVIDER_ID = "gmail";
const COOLDOWN_MS = 15 * 60 * 1000;
const SHOP_TIMEZONE = "America/Chicago";
const PUBLIC_APP_BASE = "https://lgarage.github.io/stageverify";

function getDb() {
  return admin.firestore();
}

function connectionRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}

function secretsRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}

function formatShopLocalTimestamp(isoNow: string): string {
  const date = new Date(isoNow);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function asEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || !trimmed.includes("@")) return null;
  return trimmed;
}

interface OfficeReceiverDoc {
  name?: string;
  email?: string;
  active?: boolean;
  catchAllCheckInEnabled?: boolean;
  notifyEmail?: boolean;
}

interface StagingLocationDoc {
  code?: string;
  label?: string;
  name?: string;
}

export const notifyCatchAllCheckers = onCall(
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
    const db = getDb();

    const nowIso = new Date().toISOString();
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const logId = `can-${randomUUID()}`;

    const config = await loadCatchAllConfig();
    if (!config) {
      throw new HttpsError(
        "failed-precondition",
        "Catch-all parcel intake is not enabled.",
      );
    }

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
    if (!fromEmail) {
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

    const receiversSnap = await db.collection("officeReceivers").get();
    const recipients: { email: string; name: string }[] = [];
    for (const docSnap of receiversSnap.docs) {
      const data = docSnap.data() as OfficeReceiverDoc;
      if (data.active === false) continue;
      if (data.catchAllCheckInEnabled === false) continue;
      if (data.notifyEmail === false) continue;
      const email = asEmail(data.email);
      if (!email) continue;
      const name = (data.name ?? "").trim() || email;
      recipients.push({ email, name });
    }

    if (recipients.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No office receivers are configured for catch-all email alerts.",
      );
    }

    const spotSnap = await db
      .collection("stagingLocations")
      .doc(config.catchAllStagingLocationId)
      .get();
    if (!spotSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Catch-all staging spot is not configured.",
      );
    }
    const spot = spotSnap.data() as StagingLocationDoc;
    const spotCode = (spot.code ?? "").trim();
    if (!spotCode) {
      throw new HttpsError(
        "failed-precondition",
        "Catch-all staging spot is missing a location code.",
      );
    }
    const spotLabel =
      (spot.label ?? spot.name ?? spotCode).trim() || spotCode;

    // Reserve cooldown slot atomically before outbound email (Sonnet gate MEDIUM fix).
    try {
      await db.runTransaction(async (transaction) => {
        const recentSnap = await transaction.get(
          db
            .collection("catchAllNotifyLog")
            .where("createdAt", ">", cooldownCutoff)
            .limit(1),
        );
        if (!recentSnap.empty) {
          throw new HttpsError(
            "failed-precondition",
            "A catch-all alert was sent recently. Wait 15 minutes before notifying again.",
          );
        }
        transaction.set(db.collection("catchAllNotifyLog").doc(logId), {
          id: logId,
          createdAt: nowIso,
          triggeredByUid: uid,
          catchAllStagingLocationId: config.catchAllStagingLocationId,
          spotCode,
          spotLabel,
          recipientCount: recipients.length,
          emailsSent: 0,
          pending: true,
        });
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", "Could not reserve catch-all notify slot.");
    }

    const shopLocalTime = formatShopLocalTimestamp(nowIso);
    const scanLink = `${PUBLIC_APP_BASE}/#/s?loc=${encodeURIComponent(spotCode)}`;

    const subject = `Catch-all delivery alert — ${spotCode}`;
    const bodyText = [
      "A parcel has arrived at the catch-all spot.",
      "",
      `Spot: ${spotLabel} (${spotCode})`,
      `Time: ${shopLocalTime}`,
      "",
      "To check in: scan any location QR, enter the management PIN, and tap Catch-all check-in.",
      "",
      `Optional scan link: ${scanLink}`,
      "",
      "This is an alert only — it does not mark any delivery as arrived.",
    ].join("\n");

    let accessToken: string;
    try {
      accessToken = await refreshGmailAccessToken(refreshToken);
    } catch {
      throw new HttpsError(
        "internal",
        "Could not refresh Gmail access. Reconnect in Settings.",
      );
    }

    let emailsSent = 0;
    for (const recipient of recipients) {
      try {
        const raw = buildGmailRawMessage(
          recipient.email,
          fromEmail,
          subject,
          bodyText,
          { fromDisplayName: "StageVerify Catch-all Alert" },
        );
        await sendGmailMessage(accessToken, raw);
        emailsSent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `notifyCatchAllCheckers: email to ${recipient.email} failed — ${message}`,
        );
      }
    }

    if (emailsSent === 0) {
      await db.collection("catchAllNotifyLog").doc(logId).delete();
      throw new HttpsError(
        "internal",
        "Could not send catch-all alert emails. Check Gmail connection.",
      );
    }

    await db.collection("catchAllNotifyLog").doc(logId).set({
      id: logId,
      createdAt: nowIso,
      triggeredByUid: uid,
      catchAllStagingLocationId: config.catchAllStagingLocationId,
      spotCode,
      spotLabel,
      recipientCount: recipients.length,
      emailsSent,
    });

    await incrementCatchAllPendingCount(db);

    return {
      logId,
      recipientCount: recipients.length,
      emailsSent,
    };
  },
);
