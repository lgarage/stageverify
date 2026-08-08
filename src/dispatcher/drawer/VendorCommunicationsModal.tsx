import { useEffect, useMemo, useState } from "react";
import type { DeliveryListRow, Vendor } from "../models";
import { listVendorEmailEventsForDelivery } from "../firestoreService";
import {
  inboundReplyHeaders,
  latestTrustedInboundVendorEmailEvent,
  parseEmailList,
  primaryRecipientFromEvents,
  replySubjectFromInbound,
} from "../email/vendorEmailComposeHelpers";
import {
  DRAWER_MODAL_INPUT_STYLE,
  DRAWER_MODAL_LABEL_STYLE,
} from "./resolveIssueDefaults";
import { resolveVendorForComms } from "./vendorCommsPrefillHelpers";

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && trimmed.includes("@");
}

export function VendorCommunicationsModal({
  open,
  vendors,
  deliveries,
  emailProviderConnected,
  navy,
  font,
  initialVendorId,
  initialVendorEmail,
  initialVendorName,
  initialDeliveryOrderId,
  initialSubject,
  initialBody,
  onClose,
  onSuccess,
  onSend,
}: {
  open: boolean;
  vendors: Vendor[] | null;
  deliveries: DeliveryListRow[];
  emailProviderConnected: boolean;
  navy: string;
  font: string;
  /** Pre-select vendor when opened from delivery drawer. */
  initialVendorId?: string;
  /** Delivery vendor email when opened from delivery drawer. */
  initialVendorEmail?: string;
  /** Delivery vendor name hint for orphaned id / name match. */
  initialVendorName?: string;
  /** Pre-select delivery when opened from delivery drawer. */
  initialDeliveryOrderId?: string;
  /** Issue-thread subject when no inbound reply (drawer Email Vendor). */
  initialSubject?: string;
  /** Issue-thread body when no inbound reply (drawer Email Vendor). */
  initialBody?: string;
  onClose: () => void;
  onSuccess?: () => void;
  onSend: (input: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    vendorId?: string;
    deliveryOrderId?: string;
    saveVendorEmail?: boolean;
    replyThreadId?: string;
    inReplyTo?: string;
    references?: string[];
  }) => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [additionalEmails, setAdditionalEmails] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [deliveryOrderId, setDeliveryOrderId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saveVendorEmail, setSaveVendorEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [replyFromInbound, setReplyFromInbound] = useState(false);
  const [replyHeaders, setReplyHeaders] = useState<{
    replyThreadId?: string;
    inReplyTo?: string;
    references?: string[];
  }>({});
  const [eventsLoading, setEventsLoading] = useState(false);

  const sortedVendors = useMemo(
    () => [...(vendors ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [vendors],
  );

  const sortedDeliveries = useMemo(
    () =>
      [...deliveries].sort((a, b) =>
        `${a.orderNumber} ${a.jobName}`.localeCompare(
          `${b.orderNumber} ${b.jobName}`,
        ),
      ),
    [deliveries],
  );

  const selectedVendor = sortedVendors.find((v) => v.id === vendorId) ?? null;
  const vendorEmailOnFile = selectedVendor?.email?.trim() ?? "";
  const toNormalized = to.trim().toLowerCase();
  const vendorEmailNormalized = vendorEmailOnFile.toLowerCase();
  const toDiffersFromOnFile =
    !!toNormalized &&
    !!vendorEmailNormalized &&
    toNormalized !== vendorEmailNormalized;
  const needsSaveCheckbox =
    isValidEmail(to) &&
    !!vendorId &&
    (toDiffersFromOnFile || !vendorEmailOnFile);

  useEffect(() => {
    if (!open) return;

    const vendorList = vendors ?? [];
    const deliveryRow = initialDeliveryOrderId
      ? deliveries.find((d) => d.deliveryId === initialDeliveryOrderId)
      : undefined;
    const resolved = resolveVendorForComms({
      vendors: vendorList,
      initialVendorId,
      vendorNameHint: initialVendorName ?? deliveryRow?.vendorName,
    });

    setVendorId(resolved?.id ?? "");
    setDeliveryOrderId(initialDeliveryOrderId ?? "");
    setAdditionalEmails("");
    setBody("");
    setSaveVendorEmail(false);
    setSending(false);
    setError(null);
    setValidationError(null);
    setReplyFromInbound(false);
    setReplyHeaders({});
    const baseEmail =
      initialVendorEmail?.trim() ||
      resolved?.email?.trim() ||
      "";
    setTo(baseEmail);
    setSubject("");

    const applyIssueDraftIfNewThread = () => {
      setSubject(initialSubject ?? "");
      setBody(initialBody ?? "");
    };

    if (!initialDeliveryOrderId) {
      applyIssueDraftIfNewThread();
      return;
    }

    let cancelled = false;
    setEventsLoading(true);
    void listVendorEmailEventsForDelivery(initialDeliveryOrderId)
      .then((events) => {
        if (cancelled) return;
        const vendorEmailOnFile =
          resolved?.email?.trim() ?? initialVendorEmail?.trim() ?? "";
        const inbound = latestTrustedInboundVendorEmailEvent(events);
        const primaryTo = primaryRecipientFromEvents(events, vendorEmailOnFile);
        if (primaryTo) {
          setTo(primaryTo);
        }
        if (inbound) {
          setReplyFromInbound(true);
          setReplyHeaders(inboundReplyHeaders(inbound));
          setSubject(
            replySubjectFromInbound(
              inbound,
              initialSubject ??
                (resolved?.name
                  ? `Delivery follow up — ${resolved.name}`
                  : "Delivery follow up"),
            ),
          );
        } else {
          applyIssueDraftIfNewThread();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTo(baseEmail);
          applyIssueDraftIfNewThread();
        }
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    initialVendorId,
    initialVendorEmail,
    initialVendorName,
    initialDeliveryOrderId,
    initialSubject,
    initialBody,
    vendors,
    deliveries,
  ]);

  useEffect(() => {
    if (!vendorId || initialDeliveryOrderId) return;
    const vendor = sortedVendors.find((v) => v.id === vendorId);
    if (vendor?.email?.trim() && !to.trim()) {
      setTo(vendor.email.trim());
    }
  }, [vendorId, sortedVendors, to, initialDeliveryOrderId]);

  useEffect(() => {
    if (!deliveryOrderId) return;
    const row = sortedDeliveries.find((d) => d.deliveryId === deliveryOrderId);
    if (!row) return;

    const vendorInOptions =
      !!vendorId && sortedVendors.some((v) => v.id === vendorId);

    if (vendorId && !vendorInOptions) {
      const match = resolveVendorForComms({
        vendors: sortedVendors,
        vendorNameHint: row.vendorName,
      });
      setVendorId(match?.id ?? "");
      if (match?.email?.trim()) {
        setTo((prev) => prev.trim() || match.email!.trim());
      }
      return;
    }

    if (!vendorId) {
      const match = resolveVendorForComms({
        vendors: sortedVendors,
        vendorNameHint: row.vendorName,
      });
      if (match) {
        setVendorId(match.id);
        if (match.email?.trim() && !to.trim()) {
          setTo(match.email.trim());
        }
      }
    }
  }, [deliveryOrderId, sortedDeliveries, sortedVendors, vendorId, to]);

  const parsedCc = useMemo(
    () =>
      parseEmailList(additionalEmails).filter(
        (email) => email !== toNormalized,
      ),
    [additionalEmails, toNormalized],
  );

  const canSend =
    open &&
    emailProviderConnected &&
    isValidEmail(to) &&
    !!subject.trim() &&
    !!body.trim() &&
    !sending &&
    !eventsLoading &&
    (!needsSaveCheckbox || saveVendorEmail) &&
    parsedCc.every(isValidEmail);

  const handleSend = async () => {
    setValidationError(null);
    setError(null);
    const trimmedTo = to.trim();
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!isValidEmail(trimmedTo)) {
      setValidationError("Recipient email is required.");
      return;
    }
    if (!trimmedSubject) {
      setValidationError("Subject is required.");
      return;
    }
    if (!trimmedBody) {
      setValidationError("Message body is required.");
      return;
    }
    if (needsSaveCheckbox && !saveVendorEmail) {
      setValidationError(
        "Confirm saving the email to the vendor record when the address differs or is new.",
      );
      return;
    }
    const cc = parseEmailList(additionalEmails).filter(
      (email) => email !== trimmedTo.toLowerCase(),
    );
    for (const ccEmail of cc) {
      if (!isValidEmail(ccEmail)) {
        setValidationError(`Invalid additional email: ${ccEmail}`);
        return;
      }
    }
    setSending(true);
    try {
      await onSend({
        to: trimmedTo,
        cc: cc.length > 0 ? cc : undefined,
        subject: trimmedSubject,
        body: trimmedBody,
        vendorId: vendorId || undefined,
        deliveryOrderId: deliveryOrderId || undefined,
        saveVendorEmail: needsSaveCheckbox ? saveVendorEmail : undefined,
        ...replyHeaders,
      });
      onSuccess?.();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to send vendor email.";
      setError(message);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="vendor-communications-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        data-testid="vendor-communications-modal-panel"
        className="admin-card"
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "var(--admin-surface)",
          borderRadius: "var(--admin-radius-lg)",
          padding: "24px 28px",
          boxShadow: "var(--admin-shadow-card)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 20,
            fontWeight: 700,
            color: "var(--admin-text-label)",
            fontFamily: font,
          }}
        >
          Vendor Communications
        </h2>
        <p
          data-testid="vendor-comms-helper"
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "var(--admin-text-secondary)",
            textAlign: "left",
          }}
        >
          {replyFromInbound
            ? "Replying to the vendor's latest inbound message. Add Cc addresses below if needed."
            : "This starts a new tracked vendor email thread. Replies stay in Needs Review until inbound ingest is enabled."}
        </p>

        <label
          htmlFor="vendor-comms-vendor"
          data-testid="vendor-comms-label-vendor"
          style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
        >
          Vendor
        </label>
        <select
          className="admin-control"
          id="vendor-comms-vendor"
          data-testid="vendor-comms-vendor"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        >
          <option value="">— None —</option>
          {sortedVendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.email ? ` (${v.email})` : ""}
            </option>
          ))}
        </select>

        <label
          htmlFor="vendor-comms-delivery"
          data-testid="vendor-comms-label-delivery"
          style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
        >
          Associated Delivery / Order
        </label>
        <select
          className="admin-control"
          id="vendor-comms-delivery"
          data-testid="vendor-comms-delivery"
          value={deliveryOrderId}
          onChange={(e) => setDeliveryOrderId(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        >
          <option value="">— None —</option>
          {sortedDeliveries.map((d) => (
            <option key={d.deliveryId} value={d.deliveryId}>
              {d.orderNumber} · {d.jobName} · {d.vendorName}
            </option>
          ))}
        </select>

        <label
          htmlFor="vendor-comms-to"
          data-testid="vendor-comms-label-email"
          style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
        >
          {replyFromInbound ? "Reply to" : "Email Address"}
        </label>
        <input
          className="admin-control"
          id="vendor-comms-to"
          data-testid="vendor-comms-to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="vendor@example.com"
          disabled={eventsLoading}
          style={{
            width: "100%",
            marginBottom: 6,
            padding: "10px 12px",
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />
        {replyFromInbound ? (
          <p
            data-testid="vendor-comms-reply-to-hint"
            style={{
              margin: "0 0 12px",
              fontSize: 11,
              color: "var(--admin-text-muted)",
              fontFamily: font,
            }}
          >
            Pre-filled from the vendor's latest inbound email. Edit if needed.
          </p>
        ) : null}

        <label
          htmlFor="vendor-comms-cc"
          data-testid="vendor-comms-label-additional"
          style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
        >
          Additional email addresses (optional)
        </label>
        <input
          className="admin-control"
          id="vendor-comms-cc"
          data-testid="vendor-comms-additional"
          type="text"
          value={additionalEmails}
          onChange={(e) => setAdditionalEmails(e.target.value)}
          placeholder="sales@vendor.com, branch@vendor.com"
          style={{
            width: "100%",
            marginBottom: 6,
            padding: "10px 12px",
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />
        <p
          data-testid="vendor-comms-additional-hint"
          style={{
            margin: "0 0 12px",
            fontSize: 11,
            color: "var(--admin-text-muted)",
            fontFamily: font,
          }}
        >
          Comma-separated Cc recipients (max 5).
        </p>

        {needsSaveCheckbox ? (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              color: "var(--admin-text)",
              marginBottom: 12,
              fontFamily: font,
            }}
          >
            <input
              type="checkbox"
              data-testid="vendor-comms-save-email"
              checked={saveVendorEmail}
              onChange={(e) => setSaveVendorEmail(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>Save this email to vendor record for future use</span>
          </label>
        ) : null}

        <label
          htmlFor="vendor-comms-subject"
          data-testid="vendor-comms-label-subject"
          style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
        >
          Subject
        </label>
        <input
          className="admin-control"
          id="vendor-comms-subject"
          data-testid="vendor-comms-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />

        <label
          htmlFor="vendor-comms-body"
          data-testid="vendor-comms-label-message"
          style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
        >
          Message
        </label>
        <textarea
          className="admin-control"
          id="vendor-comms-body"
          data-testid="vendor-comms-body"
          rows={body ? 10 : 4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message to vendor"
          style={{
            width: "100%",
            marginBottom: 14,
            padding: "12px 14px",
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
            fontSize: 14,
            lineHeight: 1.5,
            fontFamily: font,
            resize: "vertical",
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />

        {validationError ? (
          <p
            data-testid="vendor-comms-validation-error"
            style={{ color: "var(--admin-danger-text)", fontSize: 13, margin: "0 0 10px" }}
          >
            {validationError}
          </p>
        ) : null}

        {!emailProviderConnected ? (
          <p
            data-testid="vendor-comms-provider-disconnected"
            style={{ color: "var(--admin-warning-text)", fontSize: 13, margin: "0 0 10px" }}
          >
            Connect Gmail in Settings to send tracked vendor email.
          </p>
        ) : null}

        {error ? (
          <p
            data-testid="vendor-comms-send-error"
            style={{ color: "var(--admin-danger-text)", fontSize: 13, margin: "0 0 10px" }}
          >
            {error}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="admin-btn"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: "var(--admin-control-radius)",
              border: "1px solid var(--admin-border)",
              backgroundColor: "var(--admin-surface)",
              color: "var(--admin-text)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Close
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            data-testid="vendor-comms-send"
            disabled={!canSend}
            onClick={() => void handleSend()}
            style={{
              padding: "9px 16px",
              borderRadius: "var(--admin-control-radius)",
              border: "none",
              backgroundColor: canSend ? navy : "var(--admin-border)",
              color: canSend ? "var(--admin-on-navy)" : "var(--admin-text-muted)",
              fontSize: 13,
              fontWeight: 700,
              cursor: canSend ? "pointer" : "not-allowed",
              fontFamily: font,
              opacity: sending ? 0.7 : 1,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
