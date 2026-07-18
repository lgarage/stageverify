import type { VendorEmailEvent } from "../models";

/** Most recent inbound vendor message for a delivery (if any). */
export function latestInboundVendorEmailEvent(
  events: VendorEmailEvent[],
): VendorEmailEvent | null {
  const inbound = events.filter(
    (e) =>
      e.direction === "inbound" ||
      (e.direction === undefined && Boolean(e.senderEmail?.trim())),
  );
  if (inbound.length === 0) return null;
  return [...inbound].sort((a, b) => {
    const at = a.receivedAt ?? a.createdAt;
    const bt = b.receivedAt ?? b.createdAt;
    return bt.localeCompare(at);
  })[0];
}

/** Inbound suitable for auto-reply pre-fill (SPF/DKIM not failed; not dismissed). */
export function inboundTrustedForReply(event: VendorEmailEvent): boolean {
  if (event.reviewStatus === "rejected") return false;
  if (event.senderAuthPass === false) return false;
  return true;
}

export function latestTrustedInboundVendorEmailEvent(
  events: VendorEmailEvent[],
): VendorEmailEvent | null {
  const latest = latestInboundVendorEmailEvent(events);
  if (!latest || !inboundTrustedForReply(latest)) return null;
  return latest;
}

/** Prefer trusted inbound From address; fall back to vendor record email. */
export function primaryRecipientFromEvents(
  events: VendorEmailEvent[],
  vendorEmailOnFile: string,
): string {
  const inbound = latestTrustedInboundVendorEmailEvent(events);
  const fromInbound = inbound?.senderEmail?.trim();
  if (fromInbound && fromInbound.includes("@")) return fromInbound;
  return vendorEmailOnFile.trim();
}

export function replySubjectFromInbound(
  inbound: VendorEmailEvent | null,
  fallback: string,
): string {
  if (!inbound?.subject?.trim()) return fallback;
  const sub = inbound.subject.trim();
  if (/^re:\s/i.test(sub)) return sub;
  return `Re: ${sub}`;
}

/** Parse comma/semicolon/space-separated additional addresses (deduped, lowercased). */
export function parseEmailList(value: string): string[] {
  const parts = value
    .split(/[,;]+/)
    .flatMap((chunk) => chunk.split(/\s+/))
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("@"));
  return [...new Set(parts)];
}

export function inboundReplyHeaders(inbound: VendorEmailEvent | null): {
  replyThreadId?: string;
  inReplyTo?: string;
  references?: string[];
} {
  if (!inbound) return {};
  const refs =
    inbound.references?.filter(Boolean) ??
    (inbound.rfc822MessageId ? [inbound.rfc822MessageId] : undefined);
  return {
    replyThreadId: inbound.threadId,
    inReplyTo: inbound.rfc822MessageId,
    references: refs,
  };
}
