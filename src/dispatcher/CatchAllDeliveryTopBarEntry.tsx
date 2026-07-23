import { useEffect, useState } from "react";
import { useDispatcherPortal } from "./DispatcherPortalContext";
import { getAppSettings, notifyCatchAllCheckers } from "./firestoreService";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function CatchAllDeliveryTopBarEntry() {
  const { emailProviderConnected } = useDispatcherPortal();
  const [parcelIntakeEnabled, setParcelIntakeEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings()
      .then((settings) => {
        if (!cancelled) {
          setParcelIntakeEnabled(
            settings.parcelIntakeEnabled === true &&
              Boolean(settings.catchAllStagingLocationId?.trim()),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setParcelIntakeEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!parcelIntakeEnabled) {
    return null;
  }

  const disabled = busy || !emailProviderConnected;

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
            color: message.includes("sent") ? "#166534" : "#b91c1c",
            maxWidth: 280,
          }}
        >
          {message}
        </span>
      ) : null}
      <button
        type="button"
        data-testid="catch-all-delivery-btn"
        data-gmail-connected={emailProviderConnected ? "true" : "false"}
        disabled={disabled}
        title={
          !emailProviderConnected
            ? "Connect Gmail in Settings to send catch-all alerts."
            : undefined
        }
        onClick={handleClick}
        style={{
          padding: "4px 10px",
          borderRadius: 4,
          border: `1.5px solid ${NAVY}`,
          backgroundColor: disabled ? "#f3f4f6" : "#fff",
          color: disabled ? "#9ca3af" : NAVY,
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
    </div>
  );
}
