import type { InboundEmailProcessing, VendorEmailEvent } from "../models";

export interface SourceEmailReviewAttachment {
  filename: string;
}

export interface SourceEmailReview {
  from: string;
  to?: string;
  cc?: string;
  dateLabel: string;
  subject: string;
  bodyText: string | null;
  attachments: SourceEmailReviewAttachment[];
}

/** Locale date/time label — matches formatInboundEmailWhen in emailEvidenceCards.tsx. */
export function formatInboundReceivedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatVendorEventWhen(event: VendorEmailEvent): string {
  const iso = event.sentAt ?? event.receivedAt ?? event.createdAt;
  return formatInboundReceivedAt(iso);
}

function collectInboundAttachments(
  inbound: InboundEmailProcessing,
): SourceEmailReviewAttachment[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const name of inbound.attachmentFilenames ?? []) {
    const trimmed = name?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      names.push(trimmed);
    }
  }

  for (const att of inbound.pdfAttachments ?? []) {
    const trimmed = att.filename?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      names.push(trimmed);
    }
  }

  return names.map((filename) => ({ filename }));
}

/** Inbound invoice PDF emails never store Gmail body — bodyText is always null. */
export function sourceEmailReviewFromInbound(
  inbound: InboundEmailProcessing,
): SourceEmailReview {
  return {
    from: inbound.senderEmail || "—",
    dateLabel: formatInboundReceivedAt(inbound.receivedAt),
    subject: inbound.subject || "—",
    bodyText: null,
    attachments: collectInboundAttachments(inbound),
  };
}

function pickVendorEventBody(event: VendorEmailEvent): string | null {
  const body =
    event.bodyText?.trim() ||
    event.bodyExcerpt?.trim() ||
    event.snippet?.trim() ||
    "";
  return body || null;
}

export function sourceEmailReviewFromVendorEvent(
  event: VendorEmailEvent,
): SourceEmailReview {
  const recipients = event.recipientEmails?.filter(Boolean).join(", ");
  return {
    from: event.senderEmail || "—",
    ...(recipients ? { to: recipients } : {}),
    dateLabel: formatVendorEventWhen(event),
    subject: event.subject || "—",
    bodyText: pickVendorEventBody(event),
    attachments: [],
  };
}
