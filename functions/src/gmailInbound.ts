/**
 * Gmail inbound fetch helpers — read-only sync for invoice PDF ingestion.
 * Server-side only; never log tokens or attachment bytes.
 */
import {
  gmailClientId,
  gmailClientSecret,
  refreshGmailAccessToken,
  trimSecret,
} from "./gmailApi";
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

export function parseGmailHeaders(headers: GmailMessageHeader[] | undefined): ParsedGmailHeaders {
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

export interface ListedGmailMessage {
  id: string;
  threadId?: string;
}

export async function listRecentInboxMessageIds(
  accessToken: string,
  options?: { maxResults?: number; query?: string },
): Promise<ListedGmailMessage[]> {
  const maxResults = options?.maxResults ?? 25;
  const query = options?.query ?? "has:attachment filename:pdf in:inbox";
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    q: query,
  });
  const listed = await gmailJson<{ messages?: ListedGmailMessage[] }>(
    accessToken,
    `/messages?${params.toString()}`,
  );
  return listed.messages ?? [];
}

export interface GmailHistoryRecord {
  id: string;
  messages?: ListedGmailMessage[];
  messagesAdded?: Array<{ message?: ListedGmailMessage }>;
}

export async function listGmailHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<{ history: GmailHistoryRecord[]; historyId?: string }> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
    labelId: "INBOX",
  });
  try {
    const result = await gmailJson<{ history?: GmailHistoryRecord[]; historyId?: string }>(
      accessToken,
      `/history?${params.toString()}`,
    );
    return { history: result.history ?? [], historyId: result.historyId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      return { history: [] };
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
