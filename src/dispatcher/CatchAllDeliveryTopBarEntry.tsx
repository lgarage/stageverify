import { useEffect, useState } from "react";
import { useDispatcherPortal } from "./DispatcherPortalContext";
import {
  notifyCatchAllCheckers,
  subscribeAppSettings,
  updateAppSettings,
} from "./firestoreService";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function CatchAllDeliveryTopBarEntry() {
  const { emailProviderConnected } = useDispatcherPortal();
  const [catchAllLocationId, setCatchAllLocationId] = useState<string | null>(
    null,
  );
  const [parcelIntakeEnabled, setParcelIntakeEnabled] = useState(false);
  const [catchAllPendingCheckInCount, setCatchAllPendingCheckInCount] =
    useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let healInFlight = false;
    return subscribeAppSettings((settings) => {
      const catchAllId = settings.catchAllStagingLocationId?.trim() ?? "";
      setCatchAllLocationId(catchAllId || null);
      setParcelIntakeEnabled(
        settings.parcelIntakeEnabled === true && Boolean(catchAllId),
      );
      setCatchAllPendingCheckInCount(settings.catchAllPendingCheckInCount ?? 0);

      if (
        catchAllId &&
        settings.parcelIntakeEnabled !== true &&
        !healInFlight
      ) {
        healInFlight = true;
        void updateAppSettings({
          catchAllStagingLocationId: catchAllId,
          parcelIntakeEnabled: true,
        }).finally(() => {
          healInFlight = false;
        });
      }
    });
  }, []);

  if (!catchAllLocationId) {
    return null;
  }

  const disabled =
    busy || !emailProviderConnected || !parcelIntakeEnabled;

  const handleClick = () => {
    if (disabled) return;
    const confirmed = window.confirm(
      "Send a catch-all delivery alert email to office receivers?\n\nThis notifies staff to check in — it does not mark any delivery as arrived.",
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    void notifyCatchAllCheckers()
      .then((result) => {
        setMessage(
          `Alert sent to ${result.emailsSent} receiver${result.emailsSent === 1 ? "" : "s"}.`,
        );
        window.setTimeout(() => setMessage(null), 5000);
      })
      .catch((err: unknown) => {
        const text =
          err instanceof Error ? err.message : "Could not send catch-all alert.";
        setMessage(text);
        window.setTimeout(() => setMessage(null), 8000);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div
      data-testid="catch-all-delivery-topbar-slot"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}
    >
      {message ? (
        <span
          data-testid="catch-all-delivery-message"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: message.includes("sent") ? "var(--admin-success-text)" : "var(--admin-danger-text)",
            maxWidth: 280,
          }}
        >
          {message}
        </span>
      ) : null}
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          data-testid="catch-all-delivery-btn"
          data-gmail-connected={emailProviderConnected ? "true" : "false"}
          disabled={disabled}
          title={
            !parcelIntakeEnabled
              ? "Catch-all intake is syncing — try again in a moment."
              : !emailProviderConnected
                ? "Connect Gmail in Settings to send catch-all alerts."
                : undefined
          }
          onClick={handleClick}
          style={{
            padding: "4px 22px 4px 10px",
            borderRadius: 4,
            border: `1.5px solid ${NAVY}`,
            backgroundColor: disabled ? "var(--admin-surface-2)" : "var(--admin-surface)",
            color: disabled ? "var(--admin-text-muted)" : "var(--admin-link)",
            fontWeight: 700,
            fontSize: 12,
            cursor: disabled ? "not-allowed" : "pointer",
            fontFamily: FONT,
            outline: "none",
            whiteSpace: "nowrap",
          }}
        >
          {busy ? "Sending…" : "Catch-all delivery"}
        </button>
        <span
          data-testid="catch-all-delivery-count-badge"
          aria-label={`${catchAllPendingCheckInCount} pending catch-all check-in${catchAllPendingCheckInCount === 1 ? "" : "s"}`}
          style={{
            position: "absolute",
            top: -6,
            right: -4,
            minWidth: 18,
            height: 18,
            padding: "0 4px",
            borderRadius: 999,
            backgroundColor: NAVY,
            color: "var(--admin-on-navy)",
            fontSize: 11,
            fontWeight: 800,
            lineHeight: "18px",
            textAlign: "center",
            fontFamily: FONT,
            pointerEvents: "none",
          }}
        >
          {catchAllPendingCheckInCount}
        </span>
      </div>
    </div>
  );
}
