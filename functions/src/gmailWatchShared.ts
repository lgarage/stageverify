/**
 * Shared Gmail push watch registration — OAuth connect, callable, renewal.
 */
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import {
  getGmailAccessTokenForProvider,
  getGmailProfile,
  registerGmailWatch,
} from "./gmailInbound";
import { runInboundGmailSync } from "./syncInboundGmail";

/** Pub/Sub topic ID — must match GMAIL_PUBSUB_TOPIC secret full path suffix. */
export const GMAIL_PUBSUB_TOPIC_ID = "gmail-inbox-notifications";

export const gmailPubsubTopic = defineSecret("GMAIL_PUBSUB_TOPIC");

const PROVIDER_ID = "gmail";

function connectionRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}

function secretsRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}

/** Full topic path from secret, or null when unset. */
export function getGmailPubsubTopicName(): string | null {
  try {
    const topicName = (gmailPubsubTopic.value() ?? "").trim();
    return topicName || null;
  } catch {
    return null;
  }
}

export interface GmailWatchRegistrationResult {
  ok: boolean;
  historyId?: string;
  watchExpiration?: string;
  initialSync?: Awaited<ReturnType<typeof runInboundGmailSync>>;
  skippedReason?: string;
}

export async function registerGmailWatchForConnection(
  db: admin.firestore.Firestore,
  options: {
    accessToken?: string;
    topicName: string;
    runInitialSync?: boolean;
  },
): Promise<GmailWatchRegistrationResult> {
  const conn = await connectionRef(db).get();
  if (!conn.exists || (conn.data() as { status?: string }).status !== "connected") {
    return { ok: false, skippedReason: "not_connected" };
  }

  const secretSnap = await secretsRef(db).get();
  const refreshToken = (secretSnap.data() as { refreshToken?: string }).refreshToken;
  if (!refreshToken) {
    return { ok: false, skippedReason: "missing_refresh_token" };
  }

  const accessToken =
    options.accessToken ?? (await getGmailAccessTokenForProvider(refreshToken));
  const watch = await registerGmailWatch(accessToken, options.topicName);
  const profile = await getGmailProfile(accessToken);
  const now = new Date().toISOString();
  const watchExpiration = new Date(Number(watch.expiration)).toISOString();

  await connectionRef(db).set(
    {
      inboundSync: {
        lastHistoryId: watch.historyId ?? profile.historyId,
        lastSyncAt: now,
        watchExpiration,
      },
      updatedAt: now,
    },
    { merge: true },
  );

  const initialSync = options.runInitialSync ? await runInboundGmailSync() : undefined;

  return {
    ok: true,
    historyId: watch.historyId,
    watchExpiration,
    initialSync,
  };
}

/** Renew watch when missing or expiring within the buffer window. */
export async function renewGmailWatchIfNeeded(
  db: admin.firestore.Firestore,
  options?: { expirationBufferMs?: number },
): Promise<GmailWatchRegistrationResult> {
  const topicName = getGmailPubsubTopicName();
  if (!topicName) {
    return { ok: false, skippedReason: "topic_not_configured" };
  }

  const conn = await connectionRef(db).get();
  if (!conn.exists || (conn.data() as { status?: string }).status !== "connected") {
    return { ok: false, skippedReason: "not_connected" };
  }

  const inboundSync = (conn.data() as { inboundSync?: { watchExpiration?: string } })
    .inboundSync;
  const bufferMs = options?.expirationBufferMs ?? 48 * 60 * 60 * 1000;
  const expiresAt = inboundSync?.watchExpiration
    ? Date.parse(inboundSync.watchExpiration)
    : NaN;

  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > bufferMs) {
    return { ok: false, skippedReason: "watch_still_valid" };
  }

  return registerGmailWatchForConnection(db, { topicName, runInitialSync: false });
}
