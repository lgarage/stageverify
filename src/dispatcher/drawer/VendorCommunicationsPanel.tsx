import { useEffect, useState } from "react";
import { listVendorEmailEventsForDelivery } from "../firestoreService";
import type { VendorEmailEvent } from "../models";

const EMPTY_DISCONNECTED =
  "No messages yet. Connect Gmail in Settings to send vendor email.";
const EMPTY_CONNECTED =
  "No outbound messages yet. Use Resolve Issue to email the vendor.";

function formatSentAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function outboundEvents(events: VendorEmailEvent[]): VendorEmailEvent[] {
  return events.filter((e) => e.direction === "outbound");
}

export function VendorCommunicationsPanel({
  navy,
  font,
  emailProviderConnected,
  deliveryOrderId,
  refreshKey = 0,
  expandSignal = 0,
}: {
  navy: string;
  font: string;
  emailProviderConnected: boolean;
  deliveryOrderId: string | null;
  refreshKey?: number;
  /** Increment to expand panel (e.g. from Readiness Evidence View Full Email Chain). */
  expandSignal?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<VendorEmailEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const outbound = outboundEvents(events);
  const count = outbound.length;
  const emptyMessage = emailProviderConnected ? EMPTY_CONNECTED : EMPTY_DISCONNECTED;

  useEffect(() => {
    if (expandSignal > 0) {
      setExpanded(true);
    }
  }, [expandSignal]);

  useEffect(() => {
    if (!deliveryOrderId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void listVendorEmailEventsForDelivery(deliveryOrderId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Could not load vendor communications.");
          setEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deliveryOrderId, refreshKey]);

  return (
    <div
      data-testid="vendor-communications-panel"
      style={{
        backgroundColor: "#f8fafc",
        border: "1px solid #e0e3e8",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <button
        type="button"
        data-testid="vendor-communications-toggle"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: 0,
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: font,
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: navy,
            letterSpacing: "0.02em",
          }}
        >
          Vendor Communications ({count})
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {loading && (
            <p
              data-testid="vendor-communications-loading"
              style={{ margin: 0, fontSize: 13, color: "#64748b", fontFamily: font }}
            >
              Loading…
            </p>
          )}
          {!loading && loadError && (
            <p
              data-testid="vendor-communications-error"
              style={{ margin: 0, fontSize: 13, color: "#b91c1c", fontFamily: font }}
            >
              {loadError}
            </p>
          )}
          {!loading && !loadError && count === 0 && (
            <p
              data-testid="vendor-communications-empty"
              data-connected={emailProviderConnected ? "true" : "false"}
              style={{
                margin: 0,
                fontSize: 13,
                color: "#9ca3af",
                fontFamily: font,
              }}
            >
              {emptyMessage}
            </p>
          )}
          {!loading && !loadError && count > 0 && (
            <ul
              data-testid="vendor-communications-list"
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {outbound.map((event) => (
                <li
                  key={event.id}
                  data-testid="vendor-communications-item"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 6,
                    border: "1px solid #e2e8f0",
                    backgroundColor: "#fff",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#111827",
                      fontFamily: font,
                      marginBottom: 4,
                    }}
                  >
                    {event.subject}
                  </div>
                  {event.bodyExcerpt && (
                    <p
                      style={{
                        margin: "0 0 6px",
                        fontSize: 12,
                        color: "#475569",
                        fontFamily: font,
                        lineHeight: 1.45,
                      }}
                    >
                      {event.bodyExcerpt}
                    </p>
                  )}
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      fontFamily: font,
                    }}
                  >
                    Sent {formatSentAt(event.sentAt ?? event.receivedAt)}
                    {event.sentBy ? ` · ${event.sentBy.slice(0, 8)}…` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
