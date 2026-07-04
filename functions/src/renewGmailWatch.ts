/**
 * Scheduled Gmail watch renewal — watch expires ~7 days; renew before expiry.
 */
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import { gmailOAuthSecretsConfigured } from "./gmailInbound";
import {
  getGmailPubsubTopicName,
  gmailPubsubTopic,
  renewGmailWatchIfNeeded,
} from "./gmailWatchShared";

function getDb() {
  return admin.firestore();
}

export const renewGmailWatch = onSchedule(
  {
    schedule: "every 24 hours",
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret, gmailPubsubTopic],
  },
  async () => {
    if (!gmailOAuthSecretsConfigured()) {
      console.log("renewGmailWatch: OAuth secrets not configured — skipping");
      return;
    }

    if (!getGmailPubsubTopicName()) {
      console.log("renewGmailWatch: GMAIL_PUBSUB_TOPIC not set — skipping");
      return;
    }

    const result = await renewGmailWatchIfNeeded(getDb());
    if (result.ok) {
      console.log(
        `renewGmailWatch: renewed watch exp=${result.watchExpiration ?? "unknown"}`,
      );
      return;
    }

    console.log(`renewGmailWatch: skipped (${result.skippedReason ?? "unknown"})`);
  },
);
