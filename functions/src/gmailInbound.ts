/**
 * Gmail inbound helpers — fetch attachments + archive (remove INBOX) after persist.
 * Server-side only; never log tokens or attachment bytes. Never trash/delete messages.
 */
import {
  gmailClientId,
  gmailClientSecret,
  refreshGmailAccessToken,
  trimSecret,
} from "./gmailApi";
import { isGmailListingComplete, LIST_CAP } from "./inboundEmail/gmailInboundCatchUp";
import type { GmailMessage, GmailMessageHeader, GmailMessagePart } from "./inboundEmail/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface PdfAttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  sizeBytes: number;
}

export interface ParsedGmailHeaders {
  senderEmail: string;
  subject: string;
  receivedAt: string;
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  toAddresses?: string[];
  ccAddresses?: string[];
  deliveredTo?: string[];
  replyToAddresses?: string[];
  authenticationResults?: string;
  autoSubmitted?: string;
  precedence?: string;
}

function gmailHeadersInit(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function gmailJson<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: gmailHeadersInit(accessToken),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`gmail api ${path}: ${res.status}`);
  }
  return JSON.parse(text) as T;
}

/** True when Gmail messages.get (or similar) returns HTTP 404 — message deleted or permanently inaccessible. */
export function isGmailApiNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /gmail api .*\/messages\/[^/]+.*: 404\b/.test(message);
}

export async function getGmailAccessTokenForProvider(
  refreshToken: string,
): Promise<string> {
  return refreshGmailAccessToken(refreshToken);
}

export function parseEmailAddress(raw: string): string {
  const trimmed = raw.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  return trimmed.toLowerCase();
}

function splitAddressList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => parseEmailAddress(part))
    .filter(Boolean);
}

function parseReferencesHeader(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export function parseGmailHeaders(headers: GmailMessageHeader[] | undefined): ParsedGmailHeaders {
  try {
    const map = new Map<string, string>();
    for (const h of headers ?? []) {
      if (h.name && h.value) map.set(h.name.toLowerCase(), h.value);
    }
    const fromRaw = map.get("from") ?? "";
    const subject = (map.get("subject") ?? "").trim();
    const dateRaw = map.get("date") ?? "";
    let receivedAt = new Date().toISOString();
    if (dateRaw) {
      const parsed = Date.parse(dateRaw);
      if (!Number.isNaN(parsed)) receivedAt = new Date(parsed).toISOString();
    }
    const referencesRaw = map.get("references") ?? "";
    return {
      senderEmail: parseEmailAddress(fromRaw),
      subject,
      receivedAt,
      messageIdHeader: map.get("message-id")?.trim(),
      inReplyTo: map.get("in-reply-to")?.trim(),
      references: referencesRaw ? parseReferencesHeader(referencesRaw) : undefined,
      toAddresses: map.get("to") ? splitAddressList(map.get("to")!) : undefined,
      ccAddresses: map.get("cc") ? splitAddressList(map.get("cc")!) : undefined,
      deliveredTo: map.get("delivered-to")
        ? splitAddressList(map.get("delivered-to")!)
        : undefined,
      replyToAddresses: map.get("reply-to")
        ? splitAddressList(map.get("reply-to")!)
        : undefined,
      authenticationResults: map.get("authentication-results")?.trim(),
      autoSubmitted: map.get("auto-submitted")?.trim(),
      precedence: map.get("precedence")?.trim(),
    };
  } catch {
    const map = new Map<string, string>();
    for (const h of headers ?? []) {
      if (h.name && h.value) map.set(h.name.toLowerCase(), h.value);
    }
    const fromRaw = map.get("from") ?? "";
    const subject = (map.get("subject") ?? "").trim();
    const dateRaw = map.get("date") ?? "";
    let receivedAt = new Date().toISOString();
    if (dateRaw) {
      const parsed = Date.parse(dateRaw);
      if (!Number.isNaN(parsed)) receivedAt = new Date(parsed).toISOString();
    }
    return {
      senderEmail: parseEmailAddress(fromRaw),
      subject,
      receivedAt,
    };
  }
}

/** Extract plain-text body from a Gmail message payload (best-effort). */
export function extractGmailBodyText(
  payload: GmailMessagePart | undefined,
  maxLen = 12_000,
): string {
  if (!payload) return "";
  const parts: string[] = [];

  const walk = (part: GmailMessagePart): void => {
    const mime = (part.mimeType ?? "").toLowerCase();
    if (part.parts?.length) {
      for (const child of part.parts) walk(child);
      return;
    }
    if (mime === "text/plain" && part.body?.data) {
      parts.push(decodeGmailBodyData(part.body.data));
    }
  };

  walk(payload);
  const combined = parts.join("\n").trim();
  if (combined.length <= maxLen) return combined;
  return `${combined.slice(0, maxLen - 1)}…`;
}

function isPdfPart(part: GmailMessagePart): boolean {
  const mime = (part.mimeType ?? "").toLowerCase();
  const name = (part.filename ?? "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

/** Recursively collect PDF attachment metadata from a Gmail message payload. */
export function findPdfAttachments(payload: GmailMessagePart | undefined): PdfAttachmentRef[] {
  const out: PdfAttachmentRef[] = [];
  if (!payload) return out;

  const walk = (part: GmailMessagePart): void => {
    if (part.parts?.length) {
      for (const child of part.parts) walk(child);
      return;
    }
    if (!isPdfPart(part)) return;
    const attachmentId = part.body?.attachmentId;
    if (!attachmentId) return;
    out.push({
      filename: part.filename?.trim() || "attachment.pdf",
      mimeType: part.mimeType ?? "application/pdf",
      attachmentId,
      sizeBytes: part.body?.size ?? 0,
    });
  };

  walk(payload);
  return out;
}

export async function fetchGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  return gmailJson<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}?format=full`,
  );
}

export async function downloadGmailAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const data = await gmailJson<{ data?: string; size?: number }>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!data.data) {
    throw new Error("attachment missing data");
  }
  const normalized = data.data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

/**
 * Archive = remove INBOX label only. Never trash/delete.
 * Soft-fail policy belongs at the call site (ingest must not roll back).
 */
export async function archiveGmailMessageRemoveInbox(
  accessToken: string,
  messageId: string,
): Promise<void> {
  const res = await fetch(
    `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: "POST",
      headers: {
        ...gmailHeadersInit(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `gmail archive (remove INBOX) failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
}

export interface ListedGmailMessage {
  id: string;
  threadId?: string;
}

export async function listInboxMessageIdsPaginated(
  accessToken: string,
  options?: { query?: string; listCap?: number },
): Promise<{ messages: ListedGmailMessage[]; listingComplete: boolean }> {
  const query = options?.query ?? "has:attachment filename:pdf in:inbox";
  const listCap = options?.listCap ?? LIST_CAP;
  const messages: ListedGmailMessage[] = [];
  let pageToken: string | undefined;
  let consecutiveEmptyPages = 0;
  let finalEmptyPage = false;
  let finalNextPageToken: string | null | undefined;

  while (messages.length < listCap) {
    const pageSize = Math.min(100, listCap - messages.length);
    const params = new URLSearchParams({
      maxResults: String(pageSize),
      q: query,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const listed = await gmailJson<{
      messages?: ListedGmailMessage[];
      nextPageToken?: string;
    }>(accessToken, `/messages?${params.toString()}`);

    const batch = listed.messages ?? [];
    const emptyPage = batch.length === 0;
    finalEmptyPage = emptyPage;
    finalNextPageToken = listed.nextPageToken ?? null;

    if (emptyPage) {
      consecutiveEmptyPages += 1;
      if (!listed.nextPageToken) {
        break;
      }
      if (consecutiveEmptyPages >= 2) {
        break;
      }
      pageToken = listed.nextPageToken;
      continue;
    }

    consecutiveEmptyPages = 0;
    messages.push(...batch);

    if (messages.length >= listCap) {
      break;
    }

    if (!listed.nextPageToken) {
      break;
    }
    pageToken = listed.nextPageToken;
  }

  const trimmed = messages.slice(0, listCap);
  const listingComplete = isGmailListingComplete({
    listedCount: trimmed.length,
    listCap,
    nextPageToken: finalNextPageToken,
    emptyPage: finalEmptyPage,
  });

  return { messages: trimmed, listingComplete };
}

export async function listRecentInboxMessageIds(
  accessToken: string,
  options?: { maxResults?: number; query?: string },
): Promise<ListedGmailMessage[]> {
  const listCap = options?.maxResults ?? LIST_CAP;
  const { messages } = await listInboxMessageIdsPaginated(accessToken, {
    query: options?.query,
    listCap,
  });
  return messages;
}

export interface GmailHistoryRecord {
  id: string;
  messages?: ListedGmailMessage[];
  messagesAdded?: Array<{ message?: ListedGmailMessage }>;
}

function countUniqueHistoryMessageIds(records: GmailHistoryRecord[]): number {
  const ids = new Set<string>();
  for (const record of records) {
    for (const added of record.messagesAdded ?? []) {
      if (added.message?.id) ids.add(added.message.id);
    }
    for (const msg of record.messages ?? []) {
      if (msg.id) ids.add(msg.id);
    }
  }
  return ids.size;
}

export async function listGmailHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<{
  history: GmailHistoryRecord[];
  historyId?: string;
  listingComplete?: boolean;
}> {
  try {
    const history: GmailHistoryRecord[] = [];
    let historyId: string | undefined;
    let pageToken: string | undefined;
    let consecutiveEmptyPages = 0;
    let finalEmptyPage = false;
    let finalNextPageToken: string | null | undefined;

    while (true) {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: "messageAdded",
        labelId: "INBOX",
        maxResults: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const result = await gmailJson<{
        history?: GmailHistoryRecord[];
        historyId?: string;
        nextPageToken?: string;
      }>(accessToken, `/history?${params.toString()}`);

      if (result.historyId) historyId = result.historyId;
      const pageRecords = result.history ?? [];
      const emptyPage = pageRecords.length === 0;
      finalEmptyPage = emptyPage;
      finalNextPageToken = result.nextPageToken ?? null;

      if (emptyPage) {
        consecutiveEmptyPages += 1;
        if (!result.nextPageToken) {
          break;
        }
        if (consecutiveEmptyPages >= 2) {
          break;
        }
        pageToken = result.nextPageToken;
        continue;
      }

      consecutiveEmptyPages = 0;
      history.push(...pageRecords);

      if (countUniqueHistoryMessageIds(history) >= LIST_CAP) {
        break;
      }

      if (!result.nextPageToken) {
        break;
      }
      pageToken = result.nextPageToken;
    }

    const listedCount = countUniqueHistoryMessageIds(history);
    const listingComplete = isGmailListingComplete({
      listedCount,
      listCap: LIST_CAP,
      nextPageToken: finalNextPageToken,
      emptyPage: finalEmptyPage,
    });

    return { history, historyId, listingComplete };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/: 404\b$/.test(message)) {
      return { history: [], listingComplete: true };
    }
    throw err;
  }
}

export async function getGmailProfile(
  accessToken: string,
): Promise<{ emailAddress?: string; historyId?: string }> {
  return gmailJson<{ emailAddress?: string; historyId?: string }>(
    accessToken,
    "/profile",
  );
}

export interface GmailWatchResult {
  historyId: string;
  expiration: string;
}

export interface GmailPushNotification {
  emailAddress: string;
  historyId: string;
}

/** Decode Gmail Pub/Sub push payload (base64 JSON with emailAddress + historyId). */
export function parseGmailPushNotification(base64Data: string): GmailPushNotification | null {
  try {
    const json = Buffer.from(base64Data, "base64").toString("utf8");
    const data = JSON.parse(json) as Partial<GmailPushNotification>;
    if (!data.emailAddress?.trim() || !data.historyId?.trim()) return null;
    return {
      emailAddress: data.emailAddress.trim().toLowerCase(),
      historyId: data.historyId.trim(),
    };
  } catch {
    return null;
  }
}

/** Register Gmail push watch — requires Pub/Sub topic configured in GCP. */
export async function registerGmailWatch(
  accessToken: string,
  topicName: string,
): Promise<GmailWatchResult> {
  const res = await fetch(`${GMAIL_BASE}/watch`, {
    method: "POST",
    headers: {
      ...gmailHeadersInit(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "include",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`gmail watch failed: ${res.status}`);
  }
  const data = JSON.parse(text) as { historyId?: string; expiration?: string };
  if (!data.historyId || !data.expiration) {
    throw new Error("gmail watch missing historyId or expiration");
  }
  return { historyId: data.historyId, expiration: data.expiration };
}

export function gmailOAuthSecretsConfigured(): boolean {
  try {
    const clientId = trimSecret(gmailClientId.value());
    const clientSecret = trimSecret(gmailClientSecret.value());
    return Boolean(clientId && clientSecret);
  } catch {
    return false;
  }
}

/** Decode base64url body data from simple single-part text messages (fixtures). */
export function decodeGmailBodyData(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}
