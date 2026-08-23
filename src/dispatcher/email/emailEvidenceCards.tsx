import { useState } from "react";
import type { InboundEmailProcessing, VendorEmailEvent } from "../models";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";
import {
  formatEmailReviewPreview,
  getEmailReviewHeadlines,
  getSvInterpretation,
  proposalNeedsDrawerReview,
} from "./emailReviewHelpers";

function formatEmailEventWhen(event: VendorEmailEvent): string {
  const iso = event.sentAt ?? event.receivedAt ?? event.createdAt;
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

function formatInboundEmailWhen(inbound: InboundEmailProcessing): string {
  try {
    return new Date(inbound.receivedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return inbound.receivedAt;
  }
}

export function EmailEvidenceCard({
  row,
  defaultShowOriginal = false,
}: {
  row: ProposedEmailUpdate;
  defaultShowOriginal?: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(defaultShowOriginal);
  const interpretation = getSvInterpretation(row);
  const needsReview = proposalNeedsDrawerReview(row);
  const headlines = needsReview ? getEmailReviewHeadlines(row) : null;
  const preview = formatEmailReviewPreview(row);
  const isCalmMatch = headlines?.tier === "matched_vendor_reply";

  return (
    <div
      data-testid={`email-evidence-card-${row.messageId}`}
      style={{
        backgroundColor: "var(--admin-surface)",
        border: "1px solid var(--admin-border)",
        borderRadius: 6,
        padding: "12px",
      }}
    >
      <div
        data-testid={`email-evidence-preview-${row.messageId}`}
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "var(--admin-surface-2)",
          border: "1px solid var(--admin-border)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--admin-text-secondary)",
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>From: </span>
          {preview.sender}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Subject: </span>
          {preview.subject}
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Received: </span>
          {preview.receivedLabel}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--admin-text-data)", lineHeight: 1.45 }}>
          {preview.replyPreview}
        </p>
      </div>

      {headlines ? (
        <>
          <p
            data-testid={`email-evidence-review-${row.messageId}`}
            style={{
              margin: "0 0 4px",
              fontSize: 12,
              fontWeight: 700,
              color: isCalmMatch ? "var(--admin-accent)" : "var(--admin-warning-text)",
            }}
          >
            {headlines.primary}
          </p>
          <p
            data-testid={`email-evidence-secondary-${row.messageId}`}
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              color: "var(--admin-text-muted)",
              lineHeight: 1.4,
            }}
          >
            {headlines.secondary}
          </p>
        </>
      ) : null}

      {interpretation.length > 0 && (
        <div
          data-testid={`email-evidence-interpretation-${row.messageId}`}
          style={{ marginBottom: 8, fontSize: 12, color: "var(--admin-text-secondary)" }}
        >
          <span style={{ fontWeight: 700, fontSize: 11, color: "var(--admin-text-muted)" }}>
            SV Interpretation:{" "}
          </span>
          {interpretation.map((line) => (
            <span key={line.label} style={{ marginRight: 10 }}>
              {line.ok ? "✓" : "○"} {line.label}
            </span>
          ))}
        </div>
      )}

      <p
        data-testid={`email-evidence-classification-${row.messageId}`}
        style={{ margin: "0 0 6px", fontSize: 11, color: "var(--admin-text-muted)" }}
      >
        {row.classification.replace(/_/g, " ")} · {row.receivedAt.slice(0, 16).replace("T", " ")}
      </p>

      {row.itemLines.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--admin-text-muted)" }}>
          {row.itemLines.length} parsed line(s)
        </p>
      )}

      {row.condition1ApprovalNote && (
        <p
          data-testid={`email-evidence-condition1-note-${row.messageId}`}
          style={{ margin: "0 0 8px", fontSize: 11, color: "var(--admin-text-muted)" }}
        >
          {row.condition1ApprovalNote}
        </p>
      )}

      <button
        type="button"
        data-testid={`email-evidence-view-original-${row.messageId}`}
        onClick={() => setShowOriginal((v) => !v)}
        style={{
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid var(--admin-accent)",
          backgroundColor: "var(--admin-surface)",
          color: "var(--admin-accent)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {showOriginal ? "Hide Original Email" : "Show Original Email"}
      </button>

      {showOriginal && (
        <div
          data-testid={`email-evidence-original-${row.messageId}`}
          style={{
            marginTop: 10,
            padding: "10px 12px",
            backgroundColor: "var(--admin-surface-2)",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--admin-text-secondary)",
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>From:</strong> {row.senderEmail}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>To:</strong> {row.recipientEmails.join(", ")}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Date:</strong> {new Date(row.receivedAt).toLocaleString()}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {row.subject}
          </div>
          <pre
            data-testid={`email-evidence-original-body-${row.messageId}`}
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            {row.originalBody}
          </pre>
        </div>
      )}
    </div>
  );
}

export function InvoiceSourceEmailCard({
  inbound,
  defaultShowOriginal = false,
}: {
  inbound: InboundEmailProcessing;
  defaultShowOriginal?: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(defaultShowOriginal);
  const attachments =
    inbound.attachmentFilenames?.filter(Boolean).join(", ") ||
    inbound.pdfAttachments?.map((att) => att.filename).filter(Boolean).join(", ") ||
    "Invoice PDF";
  const bodyPreview = inbound.combinedExtractedTextPreview?.trim() ?? "";

  return (
    <div
      data-testid={`email-evidence-invoice-source-${inbound.id}`}
      style={{
        backgroundColor: "var(--admin-surface)",
        border: "1px solid var(--admin-border)",
        borderRadius: 6,
        padding: "12px",
      }}
    >
      <p
        data-testid={`email-evidence-invoice-source-label-${inbound.id}`}
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--admin-accent)",
          letterSpacing: "0.02em",
        }}
      >
        Invoice PDF email (scanned)
      </p>
      <div
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "var(--admin-surface-2)",
          border: "1px solid var(--admin-border)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--admin-text-secondary)",
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>From: </span>
          {inbound.senderEmail || "—"}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Subject: </span>
          {inbound.subject || "—"}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Date: </span>
          {formatInboundEmailWhen(inbound)}
        </div>
        <div style={{ marginBottom: bodyPreview ? 8 : 0 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Attachment: </span>
          {attachments}
        </div>
        {bodyPreview ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--admin-text-data)", lineHeight: 1.45 }}>
            {bodyPreview.length > 220 ? `${bodyPreview.slice(0, 219).trim()}…` : bodyPreview}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        data-testid={`email-evidence-invoice-source-view-${inbound.id}`}
        onClick={() => setShowOriginal((v) => !v)}
        style={{
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid var(--admin-accent)",
          backgroundColor: "var(--admin-surface)",
          color: "var(--admin-accent)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {showOriginal ? "Hide Original Email" : "Show Original Email"}
      </button>

      {showOriginal ? (
        <div
          data-testid={`email-evidence-invoice-source-original-${inbound.id}`}
          style={{
            marginTop: 10,
            padding: "10px 12px",
            backgroundColor: "var(--admin-surface-2)",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--admin-text-secondary)",
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>From:</strong> {inbound.senderEmail || "—"}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Date:</strong> {formatInboundEmailWhen(inbound)}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {inbound.subject || "—"}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>PDF attachment:</strong> {attachments}
          </div>
          {bodyPreview ? (
            <pre
              data-testid={`email-evidence-invoice-source-body-${inbound.id}`}
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              {bodyPreview}
              {inbound.combinedExtractedTextTruncated ? "\n\n[PDF text truncated for preview]" : ""}
            </pre>
          ) : (
            <p style={{ margin: 0, color: "var(--admin-text-muted)", fontStyle: "italic" }}>
              Email body was not stored; this delivery was created from a scanned invoice PDF
              attachment.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function VendorEmailEventCard({
  event,
  defaultShowOriginal = false,
}: {
  event: VendorEmailEvent;
  defaultShowOriginal?: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(defaultShowOriginal);
  const isOutbound = event.direction === "outbound";
  const body =
    event.bodyText?.trim() ||
    event.bodyExcerpt?.trim() ||
    event.snippet?.trim() ||
    "";
  const preview =
    body.length > 220 ? `${body.slice(0, 219).trim()}…` : body;
  const recipients = event.recipientEmails?.filter(Boolean).join(", ") || "—";

  return (
    <div
      data-testid={`email-evidence-live-card-${event.id}`}
      style={{
        backgroundColor: "var(--admin-surface)",
        border: "1px solid var(--admin-border)",
        borderRadius: 6,
        padding: "12px",
      }}
    >
      <p
        data-testid={`email-evidence-live-direction-${event.id}`}
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 700,
          color: isOutbound ? "var(--admin-accent)" : "var(--admin-success-text)",
          letterSpacing: "0.02em",
        }}
      >
        {isOutbound ? "Sent by dispatcher" : "Received from vendor"}
      </p>
      <div
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "var(--admin-surface-2)",
          border: "1px solid var(--admin-border)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--admin-text-secondary)",
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>From: </span>
          {event.senderEmail}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>To: </span>
          {recipients}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Subject: </span>
          {event.subject}
        </div>
        <div style={{ marginBottom: preview ? 8 : 0 }}>
          <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Date: </span>
          {formatEmailEventWhen(event)}
        </div>
        {preview ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--admin-text-data)", lineHeight: 1.45 }}>
            {preview}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        data-testid={`email-evidence-live-view-${event.id}`}
        onClick={() => setShowOriginal((v) => !v)}
        style={{
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid var(--admin-accent)",
          backgroundColor: "var(--admin-surface)",
          color: "var(--admin-accent)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {showOriginal ? "Hide Original Email" : "Show Original Email"}
      </button>

      {showOriginal ? (
        <div
          data-testid={`email-evidence-live-original-${event.id}`}
          style={{
            marginTop: 10,
            padding: "10px 12px",
            backgroundColor: "var(--admin-surface-2)",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--admin-text-secondary)",
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>From:</strong> {event.senderEmail}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>To:</strong> {recipients}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Date:</strong> {formatEmailEventWhen(event)}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {event.subject}
          </div>
          {body ? (
            <pre
              data-testid={`email-evidence-live-body-${event.id}`}
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              {body}
            </pre>
          ) : (
            <p style={{ margin: 0, color: "var(--admin-text-muted)", fontStyle: "italic" }}>
              Message body was not stored for this email.
            </p>
          )}
          {isOutbound && event.bodyExcerpt && !event.bodyText ? (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11,
                color: "var(--admin-text-muted)",
                fontStyle: "italic",
              }}
            >
              Showing stored excerpt from outbound send (full body not archived).
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
