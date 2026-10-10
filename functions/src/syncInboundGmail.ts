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
  listInboxMessageIdsPaginated,
} from "./gmailInbound";
import {
  applyCatchUpCap,
  buildInboxCatchUpQuery,
  LIST_CAP,
  oldestFirstInboxIds,
  PROCESS_CAP,
  shouldAdvanceInboundSyncCursor,
  uniquePreserveOrder,
} from "./inboundEmail/gmailInboundCatchUp";
import { processInboundGmailMessage, shouldReprocessExistingDoc } from "./inboundEmail/processInboundGmailMessage";
import { loadReplyIngestSettings } from "./email/loadOutboundEmailContext";
import type { InboundEmailProcessingDoc, VendorInvoiceImportDoc } from "./inboundEmail/types";
import {
  sanitizeIngestErrorMessage,
  shouldPersistTokenExpired,
  type GmailIngestHealthState,
} from "./gmailIngestHealth";

const REVIEW_COLLECTION = "vendorInvoiceImports";

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

export interface RetryOnErrorBackfillPlan {
  messageIds: string[];
  /** Gmail message ids with pending_review issue imports — eligible for cached-text reparse. */
  reparseStaleReviewIds: Set<string>;
}

async function collectRetryOnErrorMessageIds(
  db: admin.firestore.Firestore,
): Promise<RetryOnErrorBackfillPlan> {
  const ids = new Set<string>();
  const reparseStaleReviewIds = new Set<string>();

  const [errorSnap, parsedSnap, issueReviewSnap] = await Promise.all([
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
    db
      .collection(REVIEW_COLLECTION)
      .where("reviewStatus", "==", "pending_review")
      .where("importStatus", "==", "issue")
      .limit(50)
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

  for (const doc of issueReviewSnap.docs) {
    const gmailMessageId = (doc.data() as VendorInvoiceImportDoc).gmailMessageId;
    if (gmailMessageId) {
      ids.add(gmailMessageId);
      reparseStaleReviewIds.add(gmailMessageId);
    }
  }

  return { messageIds: [...ids], reparseStaleReviewIds };
}

async function collectStaleIssueImportMessageIds(
  db: admin.firestore.Firestore,
): Promise<Set<string>> {
  const reparseStaleReviewIds = new Set<string>();
  const [issueReviewSnap, partialReviewSnap] = await Promise.all([
    db
      .collection(REVIEW_COLLECTION)
      .where("reviewStatus", "==", "pending_review")
      .where("importStatus", "==", "issue")
      .limit(50)
      .get(),
    db
      .collection(REVIEW_COLLECTION)
      .where("reviewStatus", "==", "pending_review")
      .where("importStatus", "==", "partial")
      .limit(50)
      .get(),
  ]);

  for (const doc of issueReviewSnap.docs) {
    const gmailMessageId = (doc.data() as VendorInvoiceImportDoc).gmailMessageId;
    if (gmailMessageId) reparseStaleReviewIds.add(gmailMessageId);
  }

  for (const doc of partialReviewSnap.docs) {
    const row = doc.data() as VendorInvoiceImportDoc;
    const lineCount = row.parsedLineCount ?? row.parsedLines?.length ?? 0;
    if (lineCount === 0 && row.gmailMessageId) {
      reparseStaleReviewIds.add(row.gmailMessageId);
    }
  }

  return reparseStaleReviewIds;
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
): Promise<{
  messageIds: string[];
  latestHistoryId?: string;
  listingComplete: boolean;
}> {
  const { history, historyId, listingComplete } = await listGmailHistory(
    accessToken,
    startHistoryId,
  );
  const ids = new Set<string>();
  for (const record of history) {
    for (const added of record.messagesAdded ?? []) {
      if (added.message?.id) ids.add(added.message.id);
    }
    for (const msg of record.messages ?? []) {
      if (msg.id) ids.add(msg.id);
    }
  }
  return {
    messageIds: [...ids],
    latestHistoryId: historyId,
    listingComplete: listingComplete ?? true,
  };
}

function inboundProcessingDocId(gmailMessageId: string): string {
  return `inbound-${gmailMessageId}`;
}

async function filterUnprocessedCatchUpMessageIds(
  db: admin.firestore.Firestore,
  gmailMessageIds: string[],
): Promise<string[]> {
  const unprocessed: string[] = [];
  const chunkSize = 100;
  for (let i = 0; i < gmailMessageIds.length; i += chunkSize) {
    const chunk = gmailMessageIds.slice(i, i + chunkSize);
    const refs = chunk.map((id) =>
      db.collection(INBOUND_COLLECTION).doc(inboundProcessingDocId(id)),
    );
    const snaps = await db.getAll(...refs);
    for (let j = 0; j < chunk.length; j += 1) {
      if (!snaps[j]?.exists) {
        unprocessed.push(chunk[j]!);
      }
    }
  }
  return unprocessed;
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
    const connSnap = await connectionRef(db).get();
    const status = connSnap.exists
      ? (connSnap.data() as { status?: string }).status
      : undefined;
    if (status === "connected" || status === "token_expired") {
      const now = new Date().toISOString();
      const existing = connSnap.data() as
        | { ingestHealth?: GmailIngestHealthState }
        | undefined;
      const existingHealth = existing?.ingestHealth;
      await connectionRef(db).set(
        {
          ingestHealth: {
            ...existingHealth,
            lastAttemptAt: now,
            lastError: {
              code: "oauth_unconfigured",
              message: "Gmail OAuth client credentials not configured.",
              at: now,
            },
            staleAfterHours: existingHealth?.staleAfterHours ?? 2,
          },
          updatedAt: now,
        },
        { merge: true },
      );
    }
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

  const connSnap = await connectionRef(db).get();
  const connData = connSnap.data() as {
    inboundSync?: InboundSyncState;
    ingestHealth?: GmailIngestHealthState;
  } | undefined;
  const inboundSync = connData?.inboundSync ?? {};
  const existingIngestHealth = connData?.ingestHealth;

  let accessToken: string;
  try {
    accessToken = await getGmailAccessTokenForProvider(refreshToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("syncInboundGmail token refresh failed:", message);
    const now = new Date().toISOString();
    const connectionWrite: Record<string, unknown> = {
      updatedAt: now,
      ingestHealth: {
        ...existingIngestHealth,
        lastTokenRefreshFailureAt: now,
        tokenRefreshFailed: true,
        lastAttemptAt: now,
        lastError: {
          code: "token_refresh_failed",
          message: sanitizeIngestErrorMessage(message),
          at: now,
        },
        staleAfterHours: existingIngestHealth?.staleAfterHours ?? 2,
        lastSuccessfulSyncAt: existingIngestHealth?.lastSuccessfulSyncAt,
      },
    };
    if (shouldPersistTokenExpired(message)) {
      connectionWrite.provider = PROVIDER_ID;
      connectionWrite.status = "token_expired";
    }
    await connectionRef(db).set(connectionWrite, { merge: true });
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

  let latestHistoryId = inboundSync.lastHistoryId;
  const nowMs = Date.now();
  const replySettings = await loadReplyIngestSettings();

  let historyMessageIds: string[] = [];
  let historyListingComplete = true;

  if (inboundSync.lastHistoryId) {
    const historyResult = await collectMessageIdsFromHistory(
      accessToken,
      inboundSync.lastHistoryId,
    );
    historyMessageIds = historyResult.messageIds;
    historyListingComplete = historyResult.listingComplete;
    if (historyResult.latestHistoryId) {
      latestHistoryId = historyResult.latestHistoryId;
    }
  }

  const catchUpQuery = buildInboxCatchUpQuery({
    lastSyncAt: inboundSync.lastSyncAt,
    replyEnabled: replySettings.enabled,
    nowMs,
  });
  const afterListResult = await listInboxMessageIdsPaginated(accessToken, {
    query: catchUpQuery,
    listCap: LIST_CAP,
  });
  const afterMessageIdsOldestFirst = oldestFirstInboxIds(
    afterListResult.messages.map((m) => m.id),
  );
  const afterListingComplete = afterListResult.listingComplete;

  const catchUpIds = uniquePreserveOrder([
    ...historyMessageIds,
    ...afterMessageIdsOldestFirst,
  ]);

  const unprocessedCatchUpIds = await filterUnprocessedCatchUpMessageIds(db, catchUpIds);

  const { processNow, remainderCount } = applyCatchUpCap({
    listedIds: unprocessedCatchUpIds,
    cap: PROCESS_CAP,
  });

  const listingComplete = historyListingComplete && afterListingComplete;

  if (!latestHistoryId) {
    const profile = await getGmailProfile(accessToken);
    if (profile.historyId) latestHistoryId = profile.historyId;
  }

  let messageIds = [...processNow];

  let reparseStaleReviewIds = await collectStaleIssueImportMessageIds(db);
  messageIds = [...new Set([...messageIds, ...reparseStaleReviewIds])];

  if (options?.retryOnError) {
    const backfill = await collectRetryOnErrorMessageIds(db);
    reparseStaleReviewIds = new Set([
      ...reparseStaleReviewIds,
      ...backfill.reparseStaleReviewIds,
    ]);
    messageIds = [...new Set([...messageIds, ...backfill.messageIds])];
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
        reparseStaleReviews: reparseStaleReviewIds.has(messageId),
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
  const advanceCursor = shouldAdvanceInboundSyncCursor({
    listingComplete,
    remainderCount,
  });

  await connectionRef(db).set(
    {
      inboundSync: {
        ...inboundSync,
        ...(advanceCursor
          ? {
              lastHistoryId: latestHistoryId ?? inboundSync.lastHistoryId,
              lastSyncAt: now,
            }
          : {}),
      },
      updatedAt: now,
      ingestHealth: {
        ...existingIngestHealth,
        lastSuccessfulSyncAt: now,
        lastAttemptAt: now,
        tokenRefreshFailed: false,
        staleAfterHours: existingIngestHealth?.staleAfterHours ?? 2,
      },
    },
    { merge: true },
  );

  console.log(
    `syncInboundGmail: catchUpListed=${catchUpIds.length} catchUpUnprocessed=${unprocessedCatchUpIds.length} catchUpProcessNow=${processNow.length} remainder=${remainderCount} listingComplete=${listingComplete} advanceCursor=${advanceCursor} processed=${processed} skipped=${skipped} errors=${errors}`,
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
