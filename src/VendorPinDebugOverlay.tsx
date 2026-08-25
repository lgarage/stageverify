import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatAppVersionLabel } from "./appVersion";
import {
  getBundleScriptName,
  getVendorPinDebugElapsedMs,
  getVendorPinDebugEvents,
  getVendorPinDebugLastStage,
  getVendorPinDebugOriginLabel,
  isVendorPinDebugEnabled,
  subscribeVendorPinDebug,
} from "./vendorPinDebugTimeline";

const LOG_LINES = 16;

export function VendorPinDebugOverlay() {
  const [enabled] = useState(() => isVendorPinDebugEnabled());
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    return subscribeVendorPinDebug(() => {
      setTick((value) => value + 1);
    });
  }, [enabled]);

  if (!enabled || typeof document === "undefined") {
    return null;
  }

  const events = getVendorPinDebugEvents();
  const visibleLog = events.slice(-LOG_LINES);
  const elapsedMs = getVendorPinDebugElapsedMs();
  const lastStage = getVendorPinDebugLastStage();
  const originLabel = getVendorPinDebugOriginLabel();
  const bundleName = getBundleScriptName();

  return createPortal(
    <div
      data-testid="vendor-pin-debug-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        maxHeight: "40vh",
        zIndex: 99999,
        overflow: "auto",
        pointerEvents: "auto",
        backgroundColor: "#fef08a",
        color: "#0a0a0a",
        borderBottom: "3px solid #0a0a0a",
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: "11px",
        lineHeight: 1.35,
        padding: "8px 10px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "12px", marginBottom: "4px" }}>
        {formatAppVersionLabel()} · {bundleName}
      </div>
      <div style={{ marginBottom: "4px" }}>
        <span style={{ fontWeight: 700 }}>last:</span> {lastStage}
        {" · "}
        <span style={{ fontWeight: 700 }}>elapsed:</span>{" "}
        {(elapsedMs / 1000).toFixed(1)}s since {originLabel}
      </div>
      <div
        style={{
          backgroundColor: "#fffbeb",
          border: "1px solid #0a0a0a",
          borderRadius: "4px",
          padding: "6px",
          maxHeight: "22vh",
          overflowY: "auto",
        }}
      >
        {visibleLog.length === 0 ? (
          <div style={{ opacity: 0.7 }}>waiting for events…</div>
        ) : (
          visibleLog.map((event, index) => (
            <div key={`${event.t}-${index}`} style={{ whiteSpace: "pre-wrap" }}>
              +{(event.elapsedMs / 1000).toFixed(2)}s {event.stage}
              {event.message ? ` — ${event.message}` : ""}
            </div>
          ))
        )}
      </div>
      <div
        style={{
          marginTop: "6px",
          fontWeight: 700,
          fontSize: "12px",
          textAlign: "center",
        }}
      >
        Screenshot this panel
      </div>
    </div>,
    document.body,
  );
}
