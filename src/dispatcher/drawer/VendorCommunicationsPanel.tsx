import { useState } from "react";

const EMPTY_MESSAGE =
  "No messages yet — connect email provider in Settings (Phase 6)";

export function VendorCommunicationsPanel({
  navy,
  font,
}: {
  navy: string;
  font: string;
}) {
  const [expanded, setExpanded] = useState(false);

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
          style={{
            margin: "12px 0 0",
            fontSize: 13,
            color: "#9ca3af",
            fontFamily: font,
          }}
        >
          {EMPTY_MESSAGE}
        </p>
      )}
    </div>
  );
}
