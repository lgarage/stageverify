/**
 * Callable: register Gmail push watch after OAuth connect (optional Pub/Sub topic).
 * Also refreshes inbound sync history baseline.
 */
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getGmailAccessTokenForProvider,
  getGmailProfile,
  gmailOAuthSecretsConfigured,
  registerGmailWatch,
} from "./gmailInbound";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import { runInboundGmailSync } from "./syncInboundGmail";

const PROVIDER_ID = "gmail";
const gmailPubsubTopic = defineSecret("GMAIL_PUBSUB_TOPIC");

function getDb() {
  return admin.firestore();
}

function connectionRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}

function secretsRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}

export const registerGmailWatchCallable = onCall(
  {
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret, gmailPubsubTopic],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to register Gmail watch.");
    }

    if (!gmailOAuthSecretsConfigured()) {
      throw new HttpsError(
        "failed-precondition",
        "Gmail OAuth is not configured.",
      );
    }

    const topicName = (gmailPubsubTopic.value() ?? "").trim();
    if (!topicName) {
      throw new HttpsError(
        "failed-precondition",
        "GMAIL_PUBSUB_TOPIC secret is not set. Scheduled poll sync still runs via syncInboundGmail.",
      );
    }

    const db = getDb();
    const conn = await connectionRef(db).get();
    if (!conn.exists || (conn.data() as { status?: string }).status !== "connected") {
      throw new HttpsError("failed-precondition", "Gmail is not connected.");
    }

    const secretSnap = await secretsRef(db).get();
    const refreshToken = (secretSnap.data() as { refreshToken?: string }).refreshToken;
    if (!refreshToken) {
      throw new HttpsError("failed-precondition", "Gmail refresh token missing.");
    }

    const accessToken = await getGmailAccessTokenForProvider(refreshToken);
    const watch = await registerGmailWatch(accessToken, topicName);
    const profile = await getGmailProfile(accessToken);
    const now = new Date().toISOString();

    await connectionRef(db).set(
      {
        inboundSync: {
          lastHistoryId: watch.historyId ?? profile.historyId,
          lastSyncAt: now,
          watchExpiration: new Date(Number(watch.expiration)).toISOString(),
        },
        updatedAt: now,
      },
      { merge: true },
    );

    const syncResult = await runInboundGmailSync();

    return {
      ok: true,
      historyId: watch.historyId,
      watchExpiration: new Date(Number(watch.expiration)).toISOString(),
      initialSync: syncResult,
    };
  },
);
