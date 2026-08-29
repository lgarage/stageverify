import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DELIVERY_STATUS_LABEL, type DeliveryOrder } from "./models";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const PHONE_MAX_WIDTH_PX = 767;

type Props = {
  open: boolean;
  onClose: () => void;
  deliveries: DeliveryOrder[];
  sendAlertEnabled: boolean;
  sendAlertBusy: boolean;
  sendAlertDisabledTitle?: string;
  onSendAlert: () => void;
};

function usePhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isPhone;
}

function materialPreview(delivery: DeliveryOrder): string | null {
  const materials = delivery.expectedMaterials;
  if (!materials?.length) return null;
  const labels = materials
    .slice(0, 3)
    .map((item) => item.description?.trim())
    .filter(Boolean);
  if (labels.length === 0) return null;
  const suffix =
    materials.length > labels.length ? ` (+${materials.length - labels.length} more)` : "";
  return labels.join(", ") + suffix;
}

export function CatchAllDeliveryQuickSheet({
  open,
  onClose,
  deliveries,
  sendAlertEnabled,
  sendAlertBusy,
  sendAlertDisabledTitle,
  onSendAlert,
}: Props) {
  const navigate = useNavigate();
  const isPhone = usePhoneViewport();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const count = deliveries.length;

  const openDelivery = (deliveryId: string) => {
    navigate(`/dispatcher?openDelivery=${encodeURIComponent(deliveryId)}`);
    onClose();
  };

  return (
    <div
      data-testid="catch-all-quick-sheet"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        backgroundColor: "rgba(10, 15, 30, 0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: isPhone ? "flex-end" : "center",
        justifyContent: "center",
        padding: isPhone ? 0 : 16,
      }}
      onClick={onClose}
    >
      <div
        data-testid="catch-all-quick-sheet-panel"
        style={{
          width: "100%",
          maxWidth: isPhone ? "100vw" : 480,
          maxHeight: isPhone ? "85vh" : "min(85vh, 640px)",
          backgroundColor: "var(--admin-surface)",
          border: "1px solid var(--admin-border)",
          borderRadius: isPhone ? "12px 12px 0 0" : 8,
          boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid var(--admin-border)",
            position: "sticky",
            top: 0,
            backgroundColor: "var(--admin-surface)",
            zIndex: 1,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              data-testid="catch-all-quick-sheet-title"
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: NAVY,
              }}
            >
              Catch-all packages
            </h2>
            <p
              data-testid="catch-all-quick-sheet-count"
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                fontWeight: 600,
                color: "#333",
              }}
            >
              {count} {count === 1 ? "delivery" : "deliveries"} waiting
            </p>
          </div>
          <button
            type="button"
            data-testid="catch-all-quick-sheet-close"
            onClick={onClose}
            style={{
              flexShrink: 0,
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid var(--admin-border)",
              backgroundColor: "#fff",
              color: "#333",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "8px 0",
          }}
        >
          {count === 0 ? (
            <p
              data-testid="catch-all-quick-sheet-empty"
              style={{
                margin: 0,
                padding: "24px 16px",
                fontSize: 14,
                color: "#6b7280",
                textAlign: "center",
              }}
            >
              No deliveries are currently assigned to Catch-all.
            </p>
          ) : (
            deliveries.map((delivery) => {
              const preview = materialPreview(delivery);
              const statusLabel =
                DELIVERY_STATUS_LABEL[delivery.status] ?? delivery.status;
              return (
                <button
                  key={delivery.id}
                  type="button"
                  data-testid="catch-all-quick-sheet-row"
                  data-delivery-id={delivery.id}
                  onClick={() => openDelivery(delivery.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    border: "none",
                    borderBottom: "1px solid var(--admin-border)",
                    backgroundColor: "#fff",
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#333",
                    }}
                  >
                    {delivery.orderNumber?.trim() || delivery.id}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      color: "#6b7280",
                    }}
                  >
                    {delivery.vendorName?.trim() || "Vendor"}
                    {delivery.vendorInvoiceNumber?.trim()
                      ? ` · ${delivery.vendorInvoiceNumber.trim()}`
                      : ""}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      color: NAVY,
                    }}
                  >
                    {statusLabel}
                  </div>
                  {preview ? (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: "#333",
                        lineHeight: 1.35,
                      }}
                    >
                      {preview}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--admin-border)",
            backgroundColor: "var(--admin-surface)",
          }}
        >
          <button
            type="button"
            data-testid="catch-all-quick-sheet-send-alert"
            disabled={!sendAlertEnabled || sendAlertBusy}
            title={sendAlertDisabledTitle}
            onClick={onSendAlert}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 4,
              border: `1.5px solid ${NAVY}`,
              backgroundColor:
                !sendAlertEnabled || sendAlertBusy
                  ? "var(--admin-surface-2)"
                  : "#fff",
              color:
                !sendAlertEnabled || sendAlertBusy
                  ? "var(--admin-text-muted)"
                  : NAVY,
              fontWeight: 700,
              fontSize: 13,
              cursor:
                !sendAlertEnabled || sendAlertBusy ? "not-allowed" : "pointer",
              fontFamily: FONT,
            }}
          >
            {sendAlertBusy ? "Sending…" : "Send catch-all alert"}
          </button>
        </div>
      </div>
    </div>
  );
}
