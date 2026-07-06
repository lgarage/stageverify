import { useEffect, useMemo, useState } from "react";
import type { DeliveryListRow, Vendor } from "../models";
import { DRAWER_MODAL_INPUT_STYLE } from "./resolveIssueDefaults";

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
  onClose: () => void;
  onSuccess?: () => void;
  onSend: (input: {
    to: string;
    subject: string;
    body: string;
    vendorId?: string;
    deliveryOrderId?: string;
    saveVendorEmail?: boolean;
  }) => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [deliveryOrderId, setDeliveryOrderId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saveVendorEmail, setSaveVendorEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

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
    setTo("");
    setVendorId("");
    setDeliveryOrderId("");
    setSubject("");
    setBody("");
    setSaveVendorEmail(false);
    setSending(false);
    setError(null);
    setValidationError(null);
  }, [open]);

  useEffect(() => {
    if (!vendorId) return;
    const vendor = sortedVendors.find((v) => v.id === vendorId);
    if (vendor?.email?.trim() && !to.trim()) {
      setTo(vendor.email.trim());
    }
  }, [vendorId, sortedVendors, to]);

  useEffect(() => {
    if (!deliveryOrderId) return;
    const row = sortedDeliveries.find((d) => d.deliveryId === deliveryOrderId);
    if (row && !vendorId) {
      const match = sortedVendors.find((v) => v.name === row.vendorName);
      if (match) {
        setVendorId(match.id);
        if (match.email?.trim() && !to.trim()) {
          setTo(match.email.trim());
        }
      }
    }
  }, [deliveryOrderId, sortedDeliveries, sortedVendors, vendorId, to]);

  if (!open) return null;

  const canSend =
    emailProviderConnected &&
    isValidEmail(to) &&
    !!subject.trim() &&
    !!body.trim() &&
    !sending &&
    (!needsSaveCheckbox || saveVendorEmail);

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
    setSending(true);
    try {
      await onSend({
        to: trimmedTo,
        subject: trimmedSubject,
        body: trimmedBody,
        vendorId: vendorId || undefined,
        deliveryOrderId: deliveryOrderId || undefined,
        saveVendorEmail: needsSaveCheckbox ? saveVendorEmail : undefined,
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
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "24px 28px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 20,
            fontWeight: 700,
            color: navy,
            fontFamily: font,
          }}
        >
          Vendor Communications
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6b7280" }}>
          Send tracked outbound email via StageVerify. Replies stay in Needs
          Review until inbound ingest is enabled.
        </p>

        <label
          htmlFor="vendor-comms-vendor"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: font,
          }}
        >
          Vendor / Contact
        </label>
        <select
          id="vendor-comms-vendor"
          data-testid="vendor-comms-vendor"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
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
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: font,
          }}
        >
          Related Delivery / Order
        </label>
        <select
          id="vendor-comms-delivery"
          data-testid="vendor-comms-delivery"
          value={deliveryOrderId}
          onChange={(e) => setDeliveryOrderId(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
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
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: font,
          }}
        >
          Email Address
        </label>
        <input
          id="vendor-comms-to"
          data-testid="vendor-comms-to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="vendor@example.com"
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />

        {needsSaveCheckbox ? (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              color: "#374151",
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
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: font,
          }}
        >
          Subject
        </label>
        <input
          id="vendor-comms-subject"
          data-testid="vendor-comms-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />

        <label
          htmlFor="vendor-comms-body"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: font,
          }}
        >
          Message
        </label>
        <textarea
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
            borderRadius: 6,
            border: "1px solid #d1d5db",
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
            style={{ color: "#b91c1c", fontSize: 13, margin: "0 0 10px" }}
          >
            {validationError}
          </p>
        ) : null}

        {!emailProviderConnected ? (
          <p
            data-testid="vendor-comms-provider-disconnected"
            style={{ color: "#92400e", fontSize: 13, margin: "0 0 10px" }}
          >
            Connect Gmail in Settings to send tracked vendor email.
          </p>
        ) : null}

        {error ? (
          <p
            data-testid="vendor-comms-send-error"
            style={{ color: "#b91c1c", fontSize: 13, margin: "0 0 10px" }}
          >
            {error}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: "#fff",
              color: "#374151",
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
            data-testid="vendor-comms-send"
            disabled={!canSend}
            onClick={() => void handleSend()}
            style={{
              padding: "9px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: canSend ? navy : "#e5e7eb",
              color: canSend ? "#fff" : "#9ca3af",
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
