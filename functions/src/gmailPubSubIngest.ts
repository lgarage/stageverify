/**
 * Gmail inbox push ingest — Pub/Sub notification from users.watch triggers history sync.
 *
 * GCP setup (Dan): see docs/project_state.md § Gmail push ingest.
 * Firebase Eventarc subscribes to GMAIL_PUBSUB_TOPIC_ID; no manual push subscription needed.
 */
import * as admin from "firebase-admin";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import { parseGmailPushNotification } from "./gmailInbound";
import { runInboundGmailSync } from "./syncInboundGmail";
import { GMAIL_PUBSUB_TOPIC_ID } from "./gmailWatchShared";

const PROVIDER_ID = "gmail";

function getDb() {
  return admin.firestore();
}

export const gmailInboxPushIngest = onMessagePublished(
  {
    topic: GMAIL_PUBSUB_TOPIC_ID,
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret],
  },
  async (event) => {
    const rawData = event.data.message.data;
    if (!rawData) {
      console.log("gmailInboxPushIngest: empty message data — skipping");
      return;
    }

    const notification = parseGmailPushNotification(rawData);
    if (!notification) {
      console.log("gmailInboxPushIngest: unparseable push payload — skipping");
      return;
    }

    const conn = await getDb().collection("emailProviderConnections").doc(PROVIDER_ID).get();
    const connectedEmail = (
      (conn.data() as { connectedAccountEmail?: string } | undefined)?.connectedAccountEmail ?? ""
    )
      .trim()
      .toLowerCase();

    if (connectedEmail && notification.emailAddress !== connectedEmail) {
      console.log(
        `gmailInboxPushIngest: push email ${notification.emailAddress} != connected ${connectedEmail} — skipping`,
      );
      return;
    }

    console.log(
      `gmailInboxPushIngest: push for ${notification.emailAddress} historyId=${notification.historyId}`,
    );

    const result = await runInboundGmailSync();
    console.log(
      `gmailInboxPushIngest: sync processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`,
    );
  },
);
