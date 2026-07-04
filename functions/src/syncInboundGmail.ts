/**
 * Scheduled Gmail inbound sync — fallback poll for PDF invoice emails.
 *
 * Primary path: Gmail users.watch → Pub/Sub → gmailInboxPushIngest → runInboundGmailSync.
 * This schedule runs every 30 minutes when push/watch is unavailable or as a safety net.
 * Idempotent by gmailMessageId.
 */
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import {
  getGmailAccessTokenForProvider,
  getGmailProfile,
  gmailOAuthSecretsConfigured,
  listGmailHistory,
  listRecentInboxMessageIds,
} from "./gmailInbound";
import { processInboundGmailMessage, shouldReprocessExistingDoc } from "./inboundEmail/processInboundGmailMessage";
import type { InboundEmailProcessingDoc } from "./inboundEmail/types";

const INBOUND_COLLECTION = "inboundEmailProcessing";

const PROVIDER_ID = "gmail";
function getDb() {
  return admin.firestore();
}

function connectionRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}

function secretsRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}

async function collectRetryOnErrorMessageIds(
  db: admin.firestore.Firestore,
): Promise<string[]> {
  const ids = new Set<string>();

  const [errorSnap, parsedSnap] = await Promise.all([
    db
      .collection(INBOUND_COLLECTION)
      .where("processingStatus", "==", "error")
      .limit(50)
      .get(),
    db
      .collection(INBOUND_COLLECTION)
      .where("processingStatus", "==", "parsed")
      .limit(100)
      .get(),
  ]);

  for (const doc of errorSnap.docs) {
    const gmailMessageId = (doc.data() as InboundEmailProcessingDoc).gmailMessageId;
    if (gmailMessageId) ids.add(gmailMessageId);
  }

  for (const doc of parsedSnap.docs) {
    const data = doc.data() as InboundEmailProcessingDoc;
    if (shouldReprocessExistingDoc(data, { retryOnError: true })) {
      ids.add(data.gmailMessageId);
    }
  }

  return [...ids];
}

interface InboundSyncState {
  lastHistoryId?: string;
  lastSyncAt?: string;
  watchExpiration?: string;
}

async function loadRefreshToken(db: admin.firestore.Firestore): Promise<string | null> {
  const conn = await connectionRef(db).get();
  if (!conn.exists) return null;
  const status = (conn.data() as { status?: string }).status;
  if (status !== "connected") return null;

  const secretSnap = await secretsRef(db).get();
  if (!secretSnap.exists) return null;
  const refreshToken = (secretSnap.data() as { refreshToken?: string }).refreshToken;
  return refreshToken?.trim() || null;
}

async function collectMessageIdsFromHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; latestHistoryId?: string }> {
  const { history, historyId } = await listGmailHistory(accessToken, startHistoryId);
  const ids = new Set<string>();
  for (const record of history) {
    for (const added of record.messagesAdded ?? []) {
      if (added.message?.id) ids.add(added.message.id);
    }
    for (const msg of record.messages ?? []) {
      if (msg.id) ids.add(msg.id);
    }
  }
  return { messageIds: [...ids], latestHistoryId: historyId };
}

export interface InboundGmailSyncErrorDetail {
  gmailMessageId: string;
  message: string;
}

export interface InboundGmailSyncRunResult {
  processed: number;
  skipped: number;
  errors: number;
  invoicesQueued: number;
  skippedByStatus: Record<string, number>;
  skippedReviewCounts: Record<string, number>;
  errorDetails: InboundGmailSyncErrorDetail[];
}

export interface RunInboundGmailSyncOptions {
  /** Manual Refresh Now — retry messages previously marked error. */
  retryOnError?: boolean;
}

export async function runInboundGmailSync(
  options?: RunInboundGmailSyncOptions,
): Promise<InboundGmailSyncRunResult> {
  const db = getDb();
  if (!gmailOAuthSecretsConfigured()) {
    console.log("syncInboundGmail: OAuth secrets not configured — skipping");
    return {
      processed: 0,
      skipped: 0,
      errors: 0,
      invoicesQueued: 0,
      skippedByStatus: {},
      skippedReviewCounts: {},
      errorDetails: [],
    };
  }

  const refreshToken = await loadRefreshToken(db);
  if (!refreshToken) {
    console.log("syncInboundGmail: Gmail not connected — skipping");
    return {
      processed: 0,
      skipped: 0,
      errors: 0,
      invoicesQueued: 0,
      skippedByStatus: {},
      skippedReviewCounts: {},
      errorDetails: [],
    };
  }

  const accessToken = await getGmailAccessTokenForProvider(refreshToken);
  const connSnap = await connectionRef(db).get();
  const connData = connSnap.data() as { inboundSync?: InboundSyncState } | undefined;
  const inboundSync = connData?.inboundSync ?? {};

  let messageIds: string[] = [];
  let latestHistoryId = inboundSync.lastHistoryId;

  if (inboundSync.lastHistoryId) {
    const historyResult = await collectMessageIdsFromHistory(
      accessToken,
      inboundSync.lastHistoryId,
    );
    messageIds = historyResult.messageIds;
    if (historyResult.latestHistoryId) {
      latestHistoryId = historyResult.latestHistoryId;
    }
  }

  if (messageIds.length === 0) {
    const recent = await listRecentInboxMessageIds(accessToken, { maxResults: 15 });
    messageIds = recent.map((m) => m.id);
  }

  if (!latestHistoryId) {
    const profile = await getGmailProfile(accessToken);
    if (profile.historyId) latestHistoryId = profile.historyId;
  }

  if (options?.retryOnError) {
    const backfillIds = await collectRetryOnErrorMessageIds(db);
    messageIds = [...new Set([...messageIds, ...backfillIds])];
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let invoicesQueued = 0;
  const skippedByStatus: Record<string, number> = {};
  const skippedReviewCounts: Record<string, number> = {};
  const errorDetails: InboundGmailSyncErrorDetail[] = [];

  for (const messageId of messageIds) {
    try {
      const result = await processInboundGmailMessage(accessToken, messageId, {
        retryOnError: options?.retryOnError,
      });
      if (result.skipped) {
        skipped += 1;
        const status = result.skippedProcessingStatus ?? result.processingStatus;
        skippedByStatus[status] = (skippedByStatus[status] ?? 0) + 1;
        const reviewCount = result.reviewRecordIds.length;
        skippedReviewCounts[status] =
          (skippedReviewCounts[status] ?? 0) + reviewCount;
      } else {
        processed += 1;
        invoicesQueued += result.reviewRecordIds.length;
      }
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      errorDetails.push({ gmailMessageId: messageId, message: message.slice(0, 200) });
      console.error(`syncInboundGmail: message ${messageId} failed — ${message}`);
    }
  }

  const now = new Date().toISOString();
  await connectionRef(db).set(
    {
      inboundSync: {
        ...inboundSync,
        lastHistoryId: latestHistoryId ?? inboundSync.lastHistoryId,
        lastSyncAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );

  console.log(
    `syncInboundGmail: processed=${processed} skipped=${skipped} errors=${errors}`,
  );
  return {
    processed,
    skipped,
    errors,
    invoicesQueued,
    skippedByStatus,
    skippedReviewCounts,
    errorDetails,
  };
}

export const syncInboundGmail = onSchedule(
  {
    schedule: "every 30 minutes",
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret],
    timeoutSeconds: 300,
  },
  async () => {
    await runInboundGmailSync();
  },
);
