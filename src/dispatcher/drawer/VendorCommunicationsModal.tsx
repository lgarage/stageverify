import { useEffect, useMemo, useRef, useState } from "react";
import type { DeliveryListRow, Vendor, VendorEmailEvent } from "../models";
import { listVendorEmailEventsForDelivery } from "../firestoreService";
import { formatVendorDisplayName } from "../vendorDisplayName";
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

function formatEventWhen(event: VendorEmailEvent): string {
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
  const [historyEvents, setHistoryEvents] = useState<VendorEmailEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const sortedVendors = useMemo(
    () =>
      [...(vendors ?? [])].sort((a, b) =>
        formatVendorDisplayName(a).localeCompare(formatVendorDisplayName(b)),
      ),
    [vendors],
  );
  const vendorsLoading = open && vendors == null;

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

  // Hard-reset only when the modal opens or drawer initials change — NOT when
  // portal vendors/deliveries arrive later (that was wiping the dropdown choice).
  useEffect(() => {
    if (!open) return;

    setDeliveryOrderId(initialDeliveryOrderId ?? "");
    setAdditionalEmails("");
    setBody("");
    setSaveVendorEmail(false);
    setSending(false);
    setError(null);
    setValidationError(null);
    setReplyFromInbound(false);
    setReplyHeaders({});
    setVendorId("");
    setTo(initialVendorEmail?.trim() || "");
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
        const vendorEmailOnFile = initialVendorEmail?.trim() ?? "";
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
              initialSubject ?? "Delivery follow up",
            ),
          );
        } else {
          applyIssueDraftIfNewThread();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTo(initialVendorEmail?.trim() || "");
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
  ]);

  // Soft-resolve drawer vendor once the portal vendor list is available.
  // Does not override a vendor the user already selected.
  const softResolvedVendorIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      softResolvedVendorIdRef.current = null;
      return;
    }
    if (vendorId) return;
    if (!vendors?.length) return;

    const deliveryRow = initialDeliveryOrderId
      ? deliveries.find((d) => d.deliveryId === initialDeliveryOrderId)
      : undefined;
    const resolved = resolveVendorForComms({
      vendors,
      initialVendorId,
      vendorNameHint: initialVendorName ?? deliveryRow?.vendorName,
    });
    if (!resolved) return;
    if (softResolvedVendorIdRef.current === resolved.id) return;
    softResolvedVendorIdRef.current = resolved.id;
    setVendorId(resolved.id);
    if (resolved.email?.trim()) {
      setTo((prev) => prev.trim() || resolved.email!.trim());
    }
  }, [
    open,
    vendors,
    deliveries,
    vendorId,
    initialVendorId,
    initialVendorName,
    initialDeliveryOrderId,
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

  useEffect(() => {
    if (!open || !deliveryOrderId) {
      setHistoryEvents([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void listVendorEmailEventsForDelivery(deliveryOrderId)
      .then((events) => {
        if (!cancelled) setHistoryEvents(events);
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryEvents([]);
          setHistoryError("Conversation history could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, deliveryOrderId]);

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
      <style>
        {`
          .vendor-comms-workspace {
            width: min(1100px, 96vw);
            height: 90vh;
            max-height: 90vh;
            overflow: hidden;
          }
          .vendor-comms-content {
            display: grid;
            grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.85fr);
            gap: 22px;
            flex: 1;
            min-height: 0;
          }
          .vendor-comms-compose {
            display: flex;
            flex-direction: column;
            min-width: 0;
            min-height: 0;
            overflow-y: auto;
            padding-right: 4px;
          }
          .vendor-comms-history {
            min-width: 0;
            min-height: 0;
            overflow-y: auto;
          }
          @media (max-width: 900px) {
            .vendor-comms-workspace {
              width: min(96vw, 720px);
              height: 92vh;
              max-height: 92vh;
              overflow-y: auto;
            }
            .vendor-comms-content {
              display: block;
              min-height: auto;
            }
            .vendor-comms-compose,
            .vendor-comms-history {
              overflow: visible;
            }
            .vendor-comms-history {
              margin-top: 20px;
              min-height: 260px;
            }
          }
        `}
      </style>
      <div
        data-testid="vendor-communications-modal-panel"
        className="admin-card vendor-comms-workspace"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderRadius: "var(--admin-radius-lg)",
          padding: "22px 24px 20px",
          boxShadow: "var(--admin-shadow-card)",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            paddingBottom: 16,
            borderBottom: "1px solid var(--admin-border)",
            marginBottom: 18,
          }}
        >
          <h2
            style={{
              margin: "0 0 5px",
              fontSize: 22,
              fontWeight: 750,
              color: "var(--admin-text-data)",
              fontFamily: font,
            }}
          >
            Vendor Communications
          </h2>
          <p
            data-testid="vendor-comms-helper"
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--admin-text-secondary)",
              textAlign: "left",
            }}
          >
            {replyFromInbound
              ? "Replying to the vendor's latest inbound message. Add Cc addresses below if needed."
              : "This starts a new tracked vendor email thread — with or without a StageVerify job. Replies stay in Needs Review until inbound ingest is enabled."}
          </p>
        </header>

        <div
          data-testid="vendor-comms-workspace"
          className="vendor-comms-content"
        >
          <section className="vendor-comms-compose" aria-label="Compose vendor email">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "0 14px",
              }}
            >
              <div>
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
                  {vendorsLoading ? (
                    <option value="">Loading vendors…</option>
                  ) : (
                    <option value="">— None —</option>
                  )}
                  {sortedVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {formatVendorDisplayName(v)}
                      {v.email ? ` (${v.email})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="vendor-comms-delivery"
                  data-testid="vendor-comms-label-delivery"
                  style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
                >
                  Related StageVerify Job / Delivery — Optional
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
                  <option value="">
                    No existing StageVerify job — Start new conversation
                  </option>
                  {sortedDeliveries.map((d) => (
                    <option key={d.deliveryId} value={d.deliveryId}>
                      {d.orderNumber} · {d.jobName} · {d.vendorName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label
              htmlFor="vendor-comms-to"
              data-testid="vendor-comms-label-email"
              style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
            >
              To
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
            ) : vendorId && !vendorEmailOnFile ? (
              <p
                data-testid="vendor-comms-no-email-hint"
                style={{
                  margin: "0 0 12px",
                  fontSize: 11,
                  color: "var(--admin-warning-text)",
                  fontFamily: font,
                }}
              >
                No email configured for this vendor location. Enter an address
                manually, or save it to the vendor record when sending.
              </p>
            ) : (
              <div style={{ height: 12 }} />
            )}

            <label
              htmlFor="vendor-comms-cc"
              data-testid="vendor-comms-label-additional"
              style={{ ...DRAWER_MODAL_LABEL_STYLE, fontFamily: font }}
            >
              CC / Additional recipients
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
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message to vendor"
              style={{
                width: "100%",
                flex: "1 1 280px",
                minHeight: 280,
                padding: "12px 14px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
                fontSize: 14,
                lineHeight: 1.55,
                fontFamily: font,
                resize: "vertical",
                ...DRAWER_MODAL_INPUT_STYLE,
              }}
            />
          </section>

          <aside
            data-testid="vendor-comms-history"
            className="vendor-comms-history"
            style={{
              border: "1px solid var(--admin-border)",
              borderRadius: "var(--admin-radius-md)",
              backgroundColor: "var(--admin-surface-2)",
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div>
                <h3
                  style={{
                    margin: "0 0 3px",
                    fontSize: 15,
                    color: "var(--admin-text-data)",
                    fontFamily: font,
                  }}
                >
                  Conversation history
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: "var(--admin-text-secondary)",
                    fontFamily: font,
                  }}
                >
                  Read-only email activity for the selected delivery
                </p>
              </div>
              {deliveryOrderId && !historyLoading ? (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--admin-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {historyEvents.length} message{historyEvents.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            {!deliveryOrderId ? (
              <div
                style={{
                  padding: "28px 18px",
                  border: "1px dashed var(--admin-border)",
                  borderRadius: "var(--admin-control-radius)",
                  color: "var(--admin-text-secondary)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  textAlign: "center",
                  fontFamily: font,
                }}
              >
                No existing StageVerify job — start a new conversation. History for
                delivery-linked threads appears when a job is selected.
              </div>
            ) : historyLoading ? (
              <p style={{ color: "var(--admin-text-secondary)", fontSize: 13 }}>
                Loading conversation…
              </p>
            ) : historyError ? (
              <p style={{ color: "var(--admin-danger-text)", fontSize: 13 }}>
                {historyError}
              </p>
            ) : historyEvents.length === 0 ? (
              <div
                style={{
                  padding: "28px 18px",
                  border: "1px dashed var(--admin-border)",
                  borderRadius: "var(--admin-control-radius)",
                  color: "var(--admin-text-secondary)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  textAlign: "center",
                  fontFamily: font,
                }}
              >
                No tracked email yet. Your sent message will start this conversation.
              </div>
            ) : (
              <ol
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {historyEvents.map((event) => {
                  const outbound = event.direction === "outbound";
                  const preview =
                    event.bodyText?.trim() ||
                    event.bodyExcerpt?.trim() ||
                    event.snippet?.trim() ||
                    "No message preview available.";
                  return (
                    <li
                      key={event.id}
                      style={{
                        padding: "12px 13px",
                        border: "1px solid var(--admin-border)",
                        borderLeft: `3px solid ${
                          outbound
                            ? "var(--admin-accent)"
                            : "var(--admin-success-text)"
                        }`,
                        borderRadius: "var(--admin-control-radius)",
                        backgroundColor: "var(--admin-surface)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: outbound
                              ? "var(--admin-accent)"
                              : "var(--admin-success-text)",
                            textTransform: "uppercase",
                            letterSpacing: "0.035em",
                          }}
                        >
                          {outbound ? "Outbound" : "Inbound"}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--admin-text-muted)",
                            textAlign: "right",
                          }}
                        >
                          {formatEventWhen(event)}
                        </span>
                      </div>
                      <div
                        style={{
                          marginBottom: 5,
                          color: "var(--admin-text-data)",
                          fontSize: 13,
                          fontWeight: 700,
                          lineHeight: 1.35,
                        }}
                      >
                        {event.subject || "(No subject)"}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          color: "var(--admin-text-secondary)",
                          fontSize: 12,
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {preview.length > 280
                          ? `${preview.slice(0, 279).trim()}…`
                          : preview}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            paddingTop: 16,
            marginTop: 18,
            borderTop: "1px solid var(--admin-border)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {validationError ? (
              <p
                data-testid="vendor-comms-validation-error"
                style={{ color: "var(--admin-danger-text)", fontSize: 13, margin: 0 }}
              >
                {validationError}
              </p>
            ) : null}
            {!emailProviderConnected ? (
              <p
                data-testid="vendor-comms-provider-disconnected"
                style={{ color: "var(--admin-warning-text)", fontSize: 13, margin: 0 }}
              >
                Connect Gmail in Settings to send tracked vendor email.
              </p>
            ) : null}
            {error ? (
              <p
                data-testid="vendor-comms-send-error"
                style={{ color: "var(--admin-danger-text)", fontSize: 13, margin: 0 }}
              >
                {error}
              </p>
            ) : null}
          </div>
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
                padding: "9px 18px",
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
        </footer>
      </div>
    </div>
  );
}
