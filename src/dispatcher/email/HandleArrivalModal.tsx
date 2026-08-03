import { useEffect, useMemo, useState } from "react";
import type { StagingLocation } from "../models";
import { isLocationActive } from "../models";
import {
  applyVendorReplyClearBackorder,
  firestoreDataService,
  mapOccupancyByLocationId,
} from "../firestoreService";
import type { BackorderLineSummary } from "../firestoreService";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export type HandleArrivalAction = "shop_location" | "pickup_at_vendor";

export interface HandleArrivalModalProps {
  open: boolean;
  eventId: string;
  messageId: string;
  deliveryOrderId: string;
  excerpt: string;
  backorderLines: BackorderLineSummary[];
  onClose: () => void;
  onApplied: () => void;
}

export function HandleArrivalModal({
  open,
  eventId,
  messageId,
  deliveryOrderId,
  excerpt,
  backorderLines,
  onClose,
  onApplied,
}: HandleArrivalModalProps) {
  const [action, setAction] = useState<HandleArrivalAction>("shop_location");
  const [stagingLocationId, setStagingLocationId] = useState("");
  const [note, setNote] = useState("");
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>([]);
  const [zoneOccupancy, setZoneOccupancy] = useState<
    Record<string, { orderNumber: string }>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAction("shop_location");
    setStagingLocationId("");
    setNote("");
    setError(null);
    void Promise.all([
      firestoreDataService.listStagingLocations(),
      mapOccupancyByLocationId(deliveryOrderId),
    ]).then(([locations, occupancy]) => {
      setStagingLocations(locations);
      setZoneOccupancy(occupancy);
    });
  }, [open, deliveryOrderId]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, submitting]);

  const lineCount = backorderLines.length;
  const totalBoQty = useMemo(
    () => backorderLines.reduce((sum, row) => sum + row.qtyBackordered, 0),
    [backorderLines],
  );

  const canSubmit =
    !submitting &&
    lineCount > 0 &&
    (action === "pickup_at_vendor" ||
      (action === "shop_location" && stagingLocationId.trim() !== ""));

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await applyVendorReplyClearBackorder({
        eventId,
        action,
        stagingLocationId:
          action === "shop_location" ? stagingLocationId : undefined,
        dispatcherApplyNote: note.trim() || undefined,
      });
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handle arrival failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="handle-arrival-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 16,
      }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        data-testid="handle-arrival-modal-panel"
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "24px 28px",
          fontFamily: FONT,
          color: "#333",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          data-testid="handle-arrival-modal-title"
          style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: NAVY }}
        >
          Handle arrival
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
          Confirm vendor reply and clear {lineCount} backordered line
          {lineCount === 1 ? "" : "s"} ({totalBoQty} unit
          {totalBoQty === 1 ? "" : "s"}). This cannot be undone.
        </p>

        <div
          data-testid="handle-arrival-excerpt"
          style={{
            marginBottom: 16,
            padding: "10px 12px",
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            color: "#334155",
            lineHeight: 1.45,
          }}
        >
          {excerpt || "—"}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Backordered lines
          </div>
          <ul
            data-testid="handle-arrival-backorder-lines"
            style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#1e293b" }}
          >
            {backorderLines.map((row) => (
              <li key={row.id} data-testid={`handle-arrival-bo-line-${row.id}`}>
                {row.description} — {row.qtyBackordered} backordered
              </li>
            ))}
          </ul>
        </div>

        <fieldset
          style={{ border: "none", margin: "0 0 16px", padding: 0 }}
          data-testid="handle-arrival-action-fieldset"
        >
          <legend
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Fulfillment
          </legend>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              marginBottom: 10,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="radio"
              name={`handle-arrival-action-${messageId}`}
              data-testid="handle-arrival-action-shop"
              checked={action === "shop_location"}
              onChange={() => setAction("shop_location")}
            />
            <span>
              <strong>Assign shop location</strong> — vendor will redeliver to staging
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="radio"
              name={`handle-arrival-action-${messageId}`}
              data-testid="handle-arrival-action-pickup"
              checked={action === "pickup_at_vendor"}
              onChange={() => setAction("pickup_at_vendor")}
            />
            <span>
              <strong>Pick up at vendor</strong> — will-call (no shop staging)
            </span>
          </label>
        </fieldset>

        {action === "shop_location" && (
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor={`handle-arrival-staging-${messageId}`}
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 700,
                color: "#6b7280",
                marginBottom: 6,
              }}
            >
              Staging location *
            </label>
            <select
              id={`handle-arrival-staging-${messageId}`}
              data-testid="handle-arrival-staging-select"
              value={stagingLocationId}
              onChange={(e) => setStagingLocationId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1.5px solid #ccd0d7",
                borderRadius: 6,
                fontSize: 14,
                color: "#333",
                backgroundColor: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="">Select staging spot…</option>
              {stagingLocations.filter(isLocationActive).map((loc) => {
                const occupant = zoneOccupancy[loc.id];
                const inUse = Boolean(occupant);
                return (
                  <option key={loc.id} value={loc.id} disabled={inUse}>
                    {loc.code} — {loc.label}
                    {inUse ? ` (in use: ${occupant.orderNumber})` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor={`handle-arrival-note-${messageId}`}
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 700,
              color: "#6b7280",
              marginBottom: 6,
            }}
          >
            Dispatcher note (optional)
          </label>
          <textarea
            id={`handle-arrival-note-${messageId}`}
            data-testid="handle-arrival-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1.5px solid #ccd0d7",
              borderRadius: 6,
              fontSize: 14,
              color: "#333",
              backgroundColor: "#fff",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
        </div>

        {error && (
          <p
            data-testid="handle-arrival-error"
            style={{
              margin: "0 0 12px",
              padding: "8px 10px",
              borderRadius: 4,
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              fontSize: 12,
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            data-testid="handle-arrival-cancel"
            disabled={submitting}
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${NAVY}`,
              backgroundColor: "#fff",
              color: NAVY,
              fontSize: 13,
              fontWeight: 700,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="handle-arrival-confirm"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: canSubmit ? NAVY : "#94a3b8",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting
              ? "Applying…"
              : `Confirm — clear ${lineCount} line${lineCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
