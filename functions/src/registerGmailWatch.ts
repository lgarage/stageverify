/**
 * Callable: register Gmail push watch after OAuth connect (optional Pub/Sub topic).
 * Also refreshes inbound sync history baseline.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { gmailOAuthSecretsConfigured } from "./gmailInbound";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import {
  getGmailPubsubTopicName,
  gmailPubsubTopic,
  registerGmailWatchForConnection,
} from "./gmailWatchShared";

function getDb() {
  return admin.firestore();
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

    const topicName = getGmailPubsubTopicName();
    if (!topicName) {
      throw new HttpsError(
        "failed-precondition",
        "GMAIL_PUBSUB_TOPIC secret is not set. Fallback poll sync still runs via syncInboundGmail (every 30 minutes).",
      );
    }

    const result = await registerGmailWatchForConnection(getDb(), {
      topicName,
      runInitialSync: true,
    });

    if (!result.ok) {
      throw new HttpsError(
        "failed-precondition",
        `Gmail watch registration failed: ${result.skippedReason ?? "unknown"}`,
      );
    }

    return {
      ok: true,
      historyId: result.historyId,
      watchExpiration: result.watchExpiration,
      initialSync: result.initialSync,
    };
  },
);
