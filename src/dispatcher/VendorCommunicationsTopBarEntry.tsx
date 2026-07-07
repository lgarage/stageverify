import { useEffect, useState } from "react";
import { useDispatcherPortal } from "./DispatcherPortalContext";
import { VendorCommunicationsModal } from "./drawer/VendorCommunicationsModal";
import { firestoreDataService, sendVendorEmail } from "./firestoreService";
import type { DeliveryListRow } from "./models";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function VendorCommunicationsTopBarEntry() {
  const { emailProviderConnected, vendors, refreshGeneration } =
    useDispatcherPortal();
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryListRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void firestoreDataService
      .listDeliveries({ page: 1, pageSize: 1000 })
      .then((result) => {
        if (!cancelled) setDeliveries(result.items);
      })
      .catch(() => {
        if (!cancelled) setDeliveries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshGeneration]);

  return (
    <>
      <div
        data-testid="dispatcher-topbar-vendor-comms-slot"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          flexWrap: "nowrap",
        }}
      >
        {toast ? (
          <div
            data-testid="vendor-comms-toast"
            role="status"
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              backgroundColor: "#ecfdf5",
              border: "1px solid #86efac",
              color: "#166534",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONT,
              whiteSpace: "nowrap",
            }}
          >
            {toast}
          </div>
        ) : null}
        <button
          type="button"
          data-testid="vendor-communications-entry"
          onClick={() => setShowModal(true)}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: `1.5px solid ${NAVY}`,
            backgroundColor: "#fff",
            color: NAVY,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: FONT,
            outline: "none",
            whiteSpace: "nowrap",
          }}
        >
          Vendor Communications
        </button>
      </div>

      <VendorCommunicationsModal
        open={showModal}
        vendors={vendors}
        deliveries={deliveries}
        emailProviderConnected={emailProviderConnected}
        navy={NAVY}
        font={FONT}
        onClose={() => setShowModal(false)}
        onSuccess={() => {
          setShowModal(false);
          setToast("Email sent. Tracking and Reply-To applied.");
          window.setTimeout(() => setToast(null), 3500);
        }}
        onSend={async (input) => {
          await sendVendorEmail(input);
        }}
      />
    </>
  );
}
