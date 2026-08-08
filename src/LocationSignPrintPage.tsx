import { useCallback, useMemo, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PortalShell } from "./PortalShell";
import { PortalSidebar } from "./PortalSidebar";
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

/** Letter-size permanent location sign — static `#/s?loc=` QR (D8). */
export function LocationSignPrintPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const locationCode = useMemo(
    () => normalizeLocationSignCode(searchParams.get("loc")),
    [searchParams],
  );

  useLocationSignPrintDocumentTitle(locationCode);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleLocSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = normalizeLocationSignCode(String(data.get("loc") ?? ""));
    if (!next) return;
    setSearchParams({ loc: next }, { replace: true });
  };

  return (
    <PortalShell style={{ fontFamily: FONT }} forceLight>
      <PortalSidebar className="print:hidden" />

      <div className={LOCATION_SIGN_PRINT_PAGE_CLASS} style={{ backgroundColor: "#e5e7eb" }}>
        <div
          className="location-sign-print-toolbar print:hidden"
          data-testid="location-sign-print-toolbar"
          style={{ padding: "24px 30px", backgroundColor: "#e5e7eb" }}
        >
          <div
            style={{
              maxWidth: 720,
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
                color: "#0a3161",
              }}
            >
              Staging Map
            </Link>
            <form
              onSubmit={handleLocSubmit}
              style={{ display: "flex", gap: 8, flex: "1 1 200px" }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                  Spot
                </span>
                <input
                  name="loc"
                  defaultValue={locationCode}
                  placeholder="G1"
                  data-testid="location-sign-loc-input"
                  style={{
                    padding: "8px 10px",
                    borderRadius: 4,
                    border: "1px solid #cbd5e1",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#111",
                    backgroundColor: "#fff",
                    width: 96,
                  }}
                />
              </label>
              <button
                type="submit"
                style={{
                  padding: "8px 14px",
                  borderRadius: 4,
                  border: "1px solid #0a3161",
                  backgroundColor: "#fff",
                  color: "#0a3161",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Preview
              </button>
            </form>
            <button
              type="button"
              data-testid="location-sign-print-button"
              disabled={!locationCode}
              onClick={handlePrint}
              style={{
                padding: "10px 20px",
                borderRadius: 4,
                border: "none",
                backgroundColor: locationCode ? "#0a3161" : "#94a3b8",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor: locationCode ? "pointer" : "not-allowed",
                marginLeft: "auto",
              }}
            >
              Print label
            </button>
          </div>
          <p
            data-testid="location-sign-print-hint"
            style={{
              maxWidth: 720,
              margin: "10px auto 0",
              fontSize: 12,
              color: "#64748b",
              lineHeight: 1.4,
            }}
          >
            US Letter portrait — one sign per sheet. QR encodes the permanent scan URL
            for this spot. {LOCATION_SIGN_PRINT_HINT}
          </p>
        </div>

        <div
          style={{
            padding: "24px 30px 48px",
            display: "flex",
            justifyContent: "center",
            backgroundColor: "#e5e7eb",
          }}
          className="location-sign-print-stage"
        >
          {locationCode ? (
            <LocationSignPrintSheet locationCode={locationCode} />
          ) : (
            <p
              className="print:hidden"
              style={{ fontSize: 14, color: "#64748b", textAlign: "center" }}
            >
              Enter a spot code (e.g. G1) to preview the printable sign.
            </p>
          )}
        </div>
      </div>

      <style>{LOCATION_SIGN_PRINT_STYLES}</style>
    </PortalShell>
  );
}
