import { useEffect } from "react";
import {
  buildPermanentLocationUrl,
  ESL_QR_SIZE_LOCATION_SIGN,
} from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";
import { formatStagingCodeCanonical } from "./dispatcher/stagingCode";
import { PORTAL_MAIN_CLASS } from "./dispatcherPortalLayout";

export function normalizeLocationSignCode(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  return formatStagingCodeCanonical(trimmed);
}

/** Main column scrolls as one unit — avoids portal-scroll min-height clip on toolbar. */
export const LOCATION_SIGN_PRINT_PAGE_CLASS = `${PORTAL_MAIN_CLASS} location-sign-print-page`;

export const LOCATION_SIGN_PRINT_HINT =
  "In the print dialog, turn off Headers and footers for a clean sign-only page.";

const DEFAULT_DOC_TITLE = "stageverify";

/** Minimal document title during print (browser header/footer). */
export function useLocationSignPrintDocumentTitle(printTitle: string) {
  useEffect(() => {
    const minimal = printTitle.trim() || " ";
    const onBeforePrint = () => {
      document.title = minimal;
    };
    const onAfterPrint = () => {
      document.title = DEFAULT_DOC_TITLE;
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [printTitle]);
}

export const LOCATION_SIGN_PRINT_STYLES = `
  .location-sign-print-page {
    overflow-x: hidden;
    overflow-y: auto !important;
  }
  .location-sign-print-toolbar {
    flex-shrink: 0;
  }

  @media print {
    @page {
      size: letter portrait;
      margin: 0.45in;
    }
    .print\\:hidden,
    .portal-sidebar,
    .portal-topbar,
    [data-testid="dispatcher-portal-topbar"],
    .location-sign-print-toolbar,
    [data-testid="location-sign-print-hint"] {
      display: none !important;
    }
    html, body, #root {
      background: #fff !important;
      margin: 0 !important;
      padding: 0 !important;
      height: auto !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .portal-shell,
    .location-sign-print-page {
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
      margin: 0 !important;
      background: #fff !important;
    }
    .location-sign-print-stage > :not(.location-sign-print-sheet) {
      display: none !important;
    }
    .location-sign-print-sheet {
      width: 100% !important;
      max-width: none !important;
      min-height: auto !important;
      height: auto !important;
      margin: 0 !important;
      border: 2px solid #000 !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .location-sign-print-sheet--batch {
      break-after: page;
      page-break-after: always;
    }
    .location-sign-print-sheet--batch:last-child {
      break-after: auto;
      page-break-after: auto;
    }
  }
`;

type LocationSignPrintSheetProps = {
  locationCode: string;
  /** Large headline (defaults to canonical location code). */
  headlineText?: string;
  /** Screen preview spacing between sheets in batch mode */
  batchPreviewGap?: boolean;
};

/** One US Letter location sign — code, QR, SCAN FOR STATUS, down arrow. */
export function LocationSignPrintSheet({
  locationCode,
  headlineText,
  batchPreviewGap = false,
}: LocationSignPrintSheetProps) {
  const code = normalizeLocationSignCode(locationCode);
  const headline = headlineText?.trim() || code;
  const qrUrl = code ? buildPermanentLocationUrl(code, { forPrint: true }) : "";

  if (!code) return null;

  return (
    <div
      data-testid="location-sign-print-sheet"
      data-location-code={code}
      data-sign-headline={headline}
      data-permanent-url={qrUrl}
      className={`location-sign-print-sheet${batchPreviewGap ? " location-sign-print-sheet--batch" : ""}`}
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: batchPreviewGap ? "7.5in" : "7.5in",
        minHeight: "9.5in",
        margin: batchPreviewGap ? "0 auto 32px" : "0 auto",
        padding: "0.55in 0.5in",
        backgroundColor: "#fff",
        border: "2px solid #000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.28in",
        color: "#000",
      }}
    >
      <div
        data-testid="location-sign-code"
        style={{
          fontSize: "clamp(80px, 20vw, 168px)",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          color: "#000",
          textAlign: "center",
        }}
      >
        {headline}
      </div>
      <div
        style={{
          padding: 8,
          border: "2px solid #000",
          backgroundColor: "#fff",
          lineHeight: 0,
        }}
      >
        <EslQrCode value={qrUrl} variant="print" size={ESL_QR_SIZE_LOCATION_SIGN} />
      </div>
      <div
        data-testid="location-sign-scan-caption"
        style={{
          fontSize: "clamp(14px, 2.2vw, 20px)",
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#000",
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        SCAN FOR STATUS
      </div>
      <div
        data-testid="location-sign-arrow"
        aria-hidden
        style={{
          display: "flex",
          justifyContent: "center",
          lineHeight: 0,
        }}
      >
        <svg
          viewBox="0 0 64 96"
          width="clamp(72px, 14vw, 120px)"
          height="clamp(96px, 18vw, 144px)"
          role="presentation"
          data-testid="location-sign-arrow-svg"
        >
          <path d="M32 88 L56 56 L44 56 L44 8 L20 8 L20 56 L8 56 Z" fill="#000" />
        </svg>
      </div>
    </div>
  );
}
