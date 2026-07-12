import type { InboundGmailSyncResult } from "./models";

const STATUS_LABELS: Record<string, string> = {
  no_pdf: "no PDF attachment",
  error: "processing error",
  parsed: "parsed",
  extracted: "extracted",
  processing: "still processing",
};

function skippedDetailLabel(
  status: string,
  count: number,
  reviewCount: number,
): string {
  const base = STATUS_LABELS[status] ?? status;
  if (status === "parsed" && reviewCount === 0) {
    return `${count} parsed with 0 invoices queued`;
  }
  if (status === "error") {
    return `${count} ${base} — try Refresh Now again`;
  }
  return `${count} ${base}`;
}

/** Human-readable banner after Refresh Now / inbound Gmail sync. */
export function formatGmailSyncMessage(result: InboundGmailSyncResult): string {
  const parts: string[] = [];

  if ((result.invoicesQueued ?? 0) > 0) {
    const queued = result.invoicesQueued ?? 0;
    parts.push(
      `${queued} invoice${queued === 1 ? "" : "s"} queued for review`,
    );
  }

  if (result.processed > 0) {
    parts.push(
      `${result.processed} new message${result.processed === 1 ? "" : "s"} processed`,
    );
  }

  if (result.skipped > 0) {
    const skippedByStatus = result.skippedByStatus ?? {};
    const reviewCounts = result.skippedReviewCounts ?? {};
    const detailParts = Object.entries(skippedByStatus).map(([status, count]) =>
      skippedDetailLabel(status, count, reviewCounts[status] ?? 0),
    );
    if (detailParts.length > 0) {
      parts.push(detailParts.join("; "));
    } else {
      parts.push(
        `${result.skipped} message${result.skipped === 1 ? "" : "s"} already processed`,
      );
    }
  }

  if (result.errors > 0) {
    const errorDetails = result.errorDetails ?? [];
    if (errorDetails.length > 0) {
      const detailText = errorDetails
        .slice(0, 2)
        .map((e) => e.message)
        .join("; ");
      parts.push(
        `${result.errors} error${result.errors === 1 ? "" : "s"} (${detailText})`,
      );
    } else {
      parts.push(`${result.errors} error${result.errors === 1 ? "" : "s"}`);
    }
  }

  if (parts.length === 0) {
    return "Mailbox sync complete — no new emails.";
  }

  if ((result.invoicesQueued ?? 0) === 0 && result.processed === 0 && result.skipped > 0) {
    return `Mailbox sync complete — ${parts.join(", ")}. Check Needs Review → Invoice imports (All imports) or Settings → Gmail.`;
  }

  return `Mailbox sync complete — ${parts.join(", ")}.`;
}
