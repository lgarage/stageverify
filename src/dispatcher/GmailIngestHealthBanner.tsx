import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useDispatcherPortal } from "./DispatcherPortalContext";
import {
  evaluateGmailIngestHealth,
  type GmailIngestUnhealthyReason,
} from "./gmailIngestHealth";

function isGmailIngestBannerForced(search: string, windowHash: string): boolean {
  const fromSearch = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).get("svGmailIngestBanner");
  if (fromSearch === "1") return true;
  const q = windowHash.indexOf("?");
  if (q < 0) return false;
  return (
    new URLSearchParams(windowHash.slice(q + 1)).get("svGmailIngestBanner") ===
    "1"
  );
}

function reasonDetail(
  reason: GmailIngestUnhealthyReason,
  staleAfterHours: number,
): string {
  switch (reason) {
    case "token_expired":
      return "Gmail authorization expired.";
    case "token_refresh_failed":
      return "Gmail could not refresh its access token.";
    case "stale_no_sync":
      return `No successful invoice sync in the last ${staleAfterHours} hour${staleAfterHours === 1 ? "" : "s"}.`;
    default:
      return "Invoice sync may be interrupted.";
  }
}

export function GmailIngestHealthBanner() {
  const { emailProviderConnection } = useDispatcherPortal();
  const location = useLocation();
  const forced = isGmailIngestBannerForced(
    location.search,
    typeof window !== "undefined" ? window.location.hash : "",
  );

  const evaluation = useMemo(() => {
    if (!emailProviderConnection) {
      return { healthy: true as const };
    }
    return evaluateGmailIngestHealth(
      {
        connectionStatus: emailProviderConnection.status,
        connectedAt: emailProviderConnection.connectedAt,
        ingestHealth: emailProviderConnection.ingestHealth,
      },
      Date.now(),
    );
  }, [emailProviderConnection]);

  const show = forced || !evaluation.healthy;
  if (!show) return null;

  const staleAfterHours =
    emailProviderConnection?.ingestHealth?.staleAfterHours ?? 2;
  const reason: GmailIngestUnhealthyReason = forced
    ? "stale_no_sync"
    : (evaluation.unhealthyReason ?? "stale_no_sync");
  const detail = reasonDetail(reason, staleAfterHours);

  return (
    <div
      data-testid="gmail-ingest-health-banner"
      role="status"
      style={{
        padding: "10px 16px",
        backgroundColor: "#fef3c7",
        color: "#78350f",
        borderBottom: "1px solid #f59e0b",
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <strong style={{ color: "#92400e" }}>Gmail invoice ingest is not running.</strong>{" "}
      <span style={{ color: "#78350f" }}>{detail}</span>{" "}
      <Link
        to="/settings"
        style={{
          color: "#0a3161",
          fontWeight: 600,
          textDecoration: "underline",
        }}
      >
        Reconnect in Settings
      </Link>
    </div>
  );
}
