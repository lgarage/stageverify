import { useState } from "react";

const EMPTY_DISCONNECTED =
  "No messages yet — connect Gmail in Settings to enable vendor email.";
const EMPTY_CONNECTED =
  "No messages yet — outbound send and inbox watch ship in a later Phase 6 slice.";

export function VendorCommunicationsPanel({
  navy,
  font,
  emailProviderConnected,
}: {
  navy: string;
  font: string;
  emailProviderConnected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const emptyMessage = emailProviderConnected
    ? EMPTY_CONNECTED
    : EMPTY_DISCONNECTED;

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
          Vendor Communications (0)
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded && (
        <p
          data-testid="vendor-communications-empty"
          data-connected={emailProviderConnected ? "true" : "false"}
          style={{
            margin: "12px 0 0",
            fontSize: 13,
            color: "#9ca3af",
            fontFamily: font,
          }}
        >
          {emptyMessage}
        </p>
      )}
    </div>
  );
}
