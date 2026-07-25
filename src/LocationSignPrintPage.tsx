import { useCallback, useMemo, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildPermanentLocationUrl,
  ESL_QR_SIZE_LOCATION_SIGN,
} from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";
import { formatStagingCodeCanonical } from "./dispatcher/stagingCode";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
  PORTAL_SHELL_CLASS,
} from "./dispatcherPortalLayout";
import { PortalSidebar } from "./PortalSidebar";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function normalizeLocParam(raw: string | null): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  return formatStagingCodeCanonical(trimmed);
}

/** Letter-size permanent location sign — static `#/s?loc=` QR (D8). */
export function LocationSignPrintPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const locationCode = useMemo(
    () => normalizeLocParam(searchParams.get("loc")),
    [searchParams],
  );

  const qrUrl = locationCode
    ? buildPermanentLocationUrl(locationCode, { forPrint: true })
    : "";

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleLocSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = normalizeLocParam(String(data.get("loc") ?? ""));
    if (!next) return;
    setSearchParams({ loc: next }, { replace: true });
  };

  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
      <PortalSidebar className="print:hidden" />

      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "#e5e7eb" }}
      >
        <div
          className={`${PORTAL_SCROLL_CLASS} print:hidden`}
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
          <p style={{ maxWidth: 720, margin: "12px auto 0", fontSize: 12, color: "#64748b" }}>
            US Letter portrait — one sign per sheet. QR encodes the permanent scan URL
            for this spot (never changes when occupancy changes).
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
            <div
              data-testid="location-sign-print-sheet"
              data-permanent-url={qrUrl}
              className="location-sign-print-sheet"
              style={{
                boxSizing: "border-box",
                width: "100%",
                maxWidth: "7.5in",
                minHeight: "9.5in",
                margin: "0 auto",
                padding: "0.55in 0.5in",
                backgroundColor: "#fff",
                border: "4px solid #000",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.35in",
                color: "#000",
              }}
            >
              <div
                data-testid="location-sign-code"
                style={{
                  fontSize: "clamp(72px, 18vw, 140px)",
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                  color: "#000",
                  textAlign: "center",
                }}
              >
                {locationCode}
              </div>
              <div
                style={{
                  padding: 12,
                  border: "3px solid #000",
                  backgroundColor: "#fff",
                  lineHeight: 0,
                }}
              >
                <EslQrCode
                  value={qrUrl}
                  variant="print"
                  size={ESL_QR_SIZE_LOCATION_SIGN}
                />
              </div>
              <div
                data-testid="location-sign-arrow"
                aria-hidden
                style={{
                  fontSize: "clamp(48px, 12vw, 96px)",
                  fontWeight: 900,
                  lineHeight: 1,
                  color: "#000",
                }}
              >
                ↓
              </div>
            </div>
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

      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 0.45in;
          }
          .print\\:hidden { display: none !important; }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .portal-shell,
          .portal-main,
          .portal-scroll {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .location-sign-print-stage {
            padding: 0 !important;
            background: #fff !important;
          }
          .location-sign-print-sheet {
            width: 100% !important;
            max-width: none !important;
            min-height: auto !important;
            height: auto !important;
            margin: 0 !important;
            border: 4px solid #000 !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
