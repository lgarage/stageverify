import type { InboundEmailProcessing, VendorEmailEvent } from "../models";
import {
  getInboundEmailProcessing,
  getVendorInvoiceImport,
} from "../firestoreService";

export type VendorConversationHistoryDirection = "inbound" | "outbound";

export type VendorConversationHistorySource =
  | "vendorEmailEvent"
  | "invoiceSource";

/** Read-only view model for vendor comms modal history — not persisted. */
export interface VendorConversationHistoryItem {
  id: string;
  direction: VendorConversationHistoryDirection;
  timestamp: string;
  senderEmail?: string;
  recipientEmails?: string;
  subject: string;
  preview: string;
  source: VendorConversationHistorySource;
}

function eventTimestamp(event: VendorEmailEvent): string {
  return event.sentAt ?? event.receivedAt ?? event.createdAt;
}

function eventPreview(event: VendorEmailEvent): string {
  return (
    event.bodyText?.trim() ||
    event.bodyExcerpt?.trim() ||
    event.snippet?.trim() ||
    "No message preview available."
  );
}

function invoiceSourcePreview(inbound: InboundEmailProcessing): string {
  const extracted = inbound.combinedExtractedTextPreview?.trim();
  if (extracted) return extracted;
  const attachmentHint =
    inbound.attachmentFilenames?.length > 0
      ? inbound.attachmentFilenames.join(", ")
      : "PDF attachment";
  return `Invoice PDF email (${attachmentHint})`;
}

function mapVendorEmailEventToHistoryItem(
  event: VendorEmailEvent,
): VendorConversationHistoryItem {
  const outbound = event.direction === "outbound";
  const recipients = event.recipientEmails?.filter(Boolean).join(", ");
  return {
    id: event.id,
    direction: outbound ? "outbound" : "inbound",
    timestamp: eventTimestamp(event),
    senderEmail: outbound ? undefined : event.senderEmail?.trim() || undefined,
    recipientEmails: outbound ? recipients || undefined : undefined,
    subject: event.subject || "(No subject)",
    preview: eventPreview(event),
    source: "vendorEmailEvent",
  };
}

function mapInvoiceSourceToHistoryItem(
  inbound: InboundEmailProcessing,
): VendorConversationHistoryItem {
  return {
    id: `invoice-source:${inbound.id}`,
    direction: "inbound",
    timestamp: inbound.receivedAt,
    senderEmail: inbound.senderEmail?.trim() || undefined,
    subject: inbound.subject || "(No subject)",
    preview: invoiceSourcePreview(inbound),
    source: "invoiceSource",
  };
}

/** Stable key for dedupe within a merged history list. */
export function historyItemDedupeKey(item: VendorConversationHistoryItem): string {
  return item.id;
}

function shouldIncludeInvoiceSource(
  events: VendorEmailEvent[],
  inbound: InboundEmailProcessing,
): boolean {
  const gmailId = inbound.gmailMessageId?.trim();
  const linkedEventId = inbound.vendorEmailEventId?.trim();
  if (
    gmailId &&
    events.some((event) => event.sourceMessageId?.trim() === gmailId)
  ) {
    return false;
  }
  if (linkedEventId && events.some((event) => event.id === linkedEventId)) {
    return false;
  }
  return true;
}

export function mergeVendorConversationHistory(input: {
  events: VendorEmailEvent[];
  invoiceSourceEmail: InboundEmailProcessing | null;
}): VendorConversationHistoryItem[] {
  const { events, invoiceSourceEmail } = input;
  const items: VendorConversationHistoryItem[] = events.map(
    mapVendorEmailEventToHistoryItem,
  );

  if (
    invoiceSourceEmail &&
    shouldIncludeInvoiceSource(events, invoiceSourceEmail)
  ) {
    items.push(mapInvoiceSourceToHistoryItem(invoiceSourceEmail));
  }

  items.sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return items;
}

/** Load linked invoice-source inbound email; soft-fails to null. */
export async function loadLinkedInvoiceSourceEmail(
  vendorInvoiceImportId: string | undefined,
): Promise<InboundEmailProcessing | null> {
  const importId = vendorInvoiceImportId?.trim();
  if (!importId) return null;

  try {
    const row = await getVendorInvoiceImport(importId);
    const inboundId = row.inboundEmailProcessingId?.trim();
    if (!inboundId) return null;
    return await getInboundEmailProcessing(inboundId);
  } catch {
    return null;
  }
}
