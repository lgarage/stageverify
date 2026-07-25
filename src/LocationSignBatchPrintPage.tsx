import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAppSettings, listAllZones } from "./dispatcher/firestoreService";
import type { StagingLocation } from "./dispatcher/models";
import { PORTAL_SHELL_CLASS } from "./dispatcherPortalLayout";
import { PortalSidebar } from "./PortalSidebar";
import {
  buildLabelPrintCandidates,
  CATCH_ALL_SIGN_HEADLINE,
  isCatchAllLabelRow,
} from "./locationSignPrintSort";
import {
  LocationSignPrintSheet,
  LOCATION_SIGN_PRINT_HINT,
  LOCATION_SIGN_PRINT_PAGE_CLASS,
  LOCATION_SIGN_PRINT_STYLES,
  normalizeLocationSignCode,
  useLocationSignPrintDocumentTitle,
} from "./LocationSignPrintSheet";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const NAVY = "#0a3161";

/** Multi-select label print — one US Letter page per selected spot. */
export function LocationSignBatchPrintPage() {
  const navigate = useNavigate();
  const [zones, setZones] = useState<StagingLocation[]>([]);
  const [catchAllStagingLocationId, setCatchAllStagingLocationId] = useState<
    string | undefined
  >(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([listAllZones(), getAppSettings()])
      .then(([loaded, settings]) => {
        if (cancelled) return;
        const catchAllId = settings.catchAllStagingLocationId?.trim() || undefined;
        setCatchAllStagingLocationId(catchAllId);
        const candidates = buildLabelPrintCandidates(
          loaded,
          catchAllId,
          settings.shopMapLayoutExtras ?? {},
        );
        setZones(candidates);
        setSelectedIds(new Set());
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load zones");
        setZones([]);
        setSelectedIds(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedZones = useMemo(
    () => zones.filter((z) => selectedIds.has(z.id)),
    [zones, selectedIds],
  );

  const locationCodes = useMemo(
    () =>
      selectedZones
        .map((z) => normalizeLocationSignCode(z.code))
        .filter((code) => code.length > 0),
    [selectedZones],
  );

  useLocationSignPrintDocumentTitle(
    locationCodes.length > 0 ? `Labels (${locationCodes.length})` : " ",
  );

  const toggleZone = useCallback((zoneId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(zones.map((z) => z.id)));
  }, [zones]);

  const clearAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const selectionSummary = loading
    ? "Loading spots…"
    : error
      ? error
      : `${selectedIds.size} of ${zones.length} selected — one US Letter page each`;

  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
      <PortalSidebar className="print:hidden" />

      <div className={LOCATION_SIGN_PRINT_PAGE_CLASS} style={{ backgroundColor: "#e5e7eb" }}>
        <div
          className="location-sign-print-toolbar print:hidden"
          data-testid="location-sign-print-toolbar"
          style={{ padding: "24px 30px", backgroundColor: "#e5e7eb" }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={() => navigate(-1)}
              style={{
                padding: "8px 14px",
                borderRadius: 4,
                border: "1px solid #64748b",
                backgroundColor: "#fff",
                color: "#334155",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <Link
              to="/zones"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: NAVY,
              }}
            >
              Staging Map
            </Link>
            <p
              data-testid="location-sign-batch-summary"
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                flex: "1 1 200px",
              }}
            >
              {selectionSummary}
            </p>
            <button
              type="button"
              data-testid="location-sign-batch-print-button"
              disabled={loading || Boolean(error) || selectedIds.size === 0}
              onClick={handlePrint}
              style={{
                padding: "10px 20px",
                borderRadius: 4,
                border: "none",
                backgroundColor:
                  !loading && !error && selectedIds.size > 0
                    ? NAVY
                    : "#94a3b8",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor:
                  !loading && !error && selectedIds.size > 0
                    ? "pointer"
                    : "not-allowed",
                marginLeft: "auto",
              }}
            >
              Print selected labels
            </button>
          </div>

          {!loading && !error && zones.length > 0 ? (
            <div
              data-testid="location-sign-batch-picker"
              style={{
                maxWidth: 960,
                margin: "16px auto 0",
                padding: "12px 14px",
                backgroundColor: "#fff",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#111827",
                  }}
                >
                  Choose labels to print
                </span>
                <button
                  type="button"
                  data-testid="location-sign-batch-select-all"
                  onClick={selectAll}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${NAVY}`,
                    backgroundColor: "#fff",
                    color: NAVY,
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  data-testid="location-sign-batch-clear-all"
                  onClick={clearAll}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "1px solid #64748b",
                    backgroundColor: "#fff",
                    color: "#334155",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Clear all
                </button>
              </div>
              <ul
                data-testid="location-sign-batch-picker-list"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  maxHeight: 220,
                  overflowY: "auto",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 6,
                }}
              >
                {zones.map((zone) => {
                  const code = normalizeLocationSignCode(zone.code);
                  const isCatchAll = isCatchAllLabelRow(
                    zone,
                    catchAllStagingLocationId,
                  );
                  const checked = selectedIds.has(zone.id);
                  return (
                    <li key={zone.id}>
                      <label
                        data-testid="location-sign-batch-picker-row"
                        data-zone-id={zone.id}
                        data-location-code={code}
                        data-catch-all={isCatchAll ? "true" : "false"}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 8px",
                          borderRadius: 4,
                          cursor: "pointer",
                          backgroundColor: checked ? "#eff6ff" : "#f9fafb",
                          border: `1px solid ${checked ? "#93c5fd" : "#e5e7eb"}`,
                          fontSize: 13,
                          color: "#111827",
                          fontWeight: 600,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleZone(zone.id)}
                          data-testid="location-sign-batch-picker-checkbox"
                          style={{ width: 16, height: 16, accentColor: NAVY }}
                        />
                        <span>{code || zone.code}</span>
                        {isCatchAll ? (
                          <span
                            data-testid="location-sign-batch-catch-all-badge"
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: NAVY,
                              marginLeft: "auto",
                            }}
                          >
                            Catch-all
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <p
            data-testid="location-sign-print-hint"
            style={{
              maxWidth: 960,
              margin: "10px auto 0",
              fontSize: 12,
              color: "#64748b",
              lineHeight: 1.4,
            }}
          >
            Select spots above, preview sheets below, then print. Each sheet matches the
            single-spot sign layout. {LOCATION_SIGN_PRINT_HINT}
          </p>
        </div>

        <div
          data-testid="location-sign-batch-stage"
          className="location-sign-print-stage"
          style={{
            padding: "24px 30px 48px",
            backgroundColor: "#e5e7eb",
          }}
        >
          {!loading && !error && zones.length === 0 ? (
            <p
              className="print:hidden"
              style={{ fontSize: 14, color: "#64748b", textAlign: "center" }}
            >
              No spots available to print.
            </p>
          ) : null}
          {!loading && !error && zones.length > 0 && selectedIds.size === 0 ? (
            <p
              className="print:hidden"
              data-testid="location-sign-batch-none-selected"
              style={{ fontSize: 14, color: "#64748b", textAlign: "center" }}
            >
              Select at least one label above to preview and print.
            </p>
          ) : null}
          {selectedZones.map((zone) => {
            const isCatchAll = isCatchAllLabelRow(
              zone,
              catchAllStagingLocationId,
            );
            return (
              <LocationSignPrintSheet
                key={zone.id}
                locationCode={normalizeLocationSignCode(zone.code)}
                headlineText={
                  isCatchAll ? CATCH_ALL_SIGN_HEADLINE : undefined
                }
                batchPreviewGap
              />
            );
          })}
        </div>
      </div>

      <style>{LOCATION_SIGN_PRINT_STYLES}</style>
    </div>
  );
}
