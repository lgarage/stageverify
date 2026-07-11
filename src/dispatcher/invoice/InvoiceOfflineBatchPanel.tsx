import { useCallback, useRef, useState } from "react";
import type { VendorInvoiceImportReview } from "../models";
import {
  BATCH_WITH_CORRUPT_PAGE,
  SAMPLE_EIGHT_PAGE_BATCH,
} from "./invoiceBatchFixtures";
import { InvoiceParsedInspectModal } from "./InvoiceParsedInspectModal";
import {
  buildOfflineImportReviewFromPageResult,
  mapBatchResultToPreviewRows,
  type InvoiceOfflinePreviewRow,
} from "./mapBatchResultToPreviewRows";
import { adaptConcatenatedPdfText } from "./pdfTextAdapter";
import { processInvoiceBatch } from "./processInvoiceBatch";
import type { InvoiceBatchResult } from "./types";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const CARD_STYLE = {
  backgroundColor: "#fff",
  border: "1px solid #e0e3e8",
  borderRadius: 8,
  overflow: "hidden" as const,
  marginBottom: 20,
};

const PRIMARY_BUTTON = {
  backgroundColor: NAVY,
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const SECONDARY_BUTTON = {
  backgroundColor: "#fff",
  color: NAVY,
  border: `1px solid ${NAVY}`,
  borderRadius: 4,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
} as const;

function outcomeChipStyle(outcome: InvoiceOfflinePreviewRow["outcome"]) {
  if (outcome === "processed") {
    return { backgroundColor: "#ecfdf5", color: "#166534" };
  }
  if (outcome === "needs_review") {
    return { backgroundColor: "#fff7ed", color: "#9a3412" };
  }
  return { backgroundColor: "#fef2f2", color: "#991b1b" };
}

function formatConfidence(row: InvoiceOfflinePreviewRow): string {
  if (row.confidenceScore == null) return "—";
  const tier = row.confidenceTier ? ` (${row.confidenceTier})` : "";
  return `${row.confidenceScore}${tier}`;
}

export function InvoiceOfflineBatchPanel() {
  const [batchResult, setBatchResult] = useState<InvoiceBatchResult | null>(null);
  const [previewRows, setPreviewRows] = useState<InvoiceOfflinePreviewRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [inspectImport, setInspectImport] = useState<VendorInvoiceImportReview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyBatchResult = useCallback((result: InvoiceBatchResult) => {
    setBatchResult(result);
    setPreviewRows(mapBatchResultToPreviewRows(result));
    setPasteError(null);
  }, []);

  const runSample = useCallback(() => {
    applyBatchResult(processInvoiceBatch(SAMPLE_EIGHT_PAGE_BATCH));
  }, [applyBatchResult]);

  const runCorruptSample = useCallback(() => {
    applyBatchResult(processInvoiceBatch(BATCH_WITH_CORRUPT_PAGE));
  }, [applyBatchResult]);

  const processPaste = useCallback(() => {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      setPasteError("Paste extracted invoice text or load a .txt file first.");
      return;
    }
    try {
      const pages = adaptConcatenatedPdfText(trimmed);
      if (pages.length === 0) {
        setPasteError("No invoice pages found in pasted text.");
        return;
      }
      applyBatchResult(processInvoiceBatch(pages));
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err));
    }
  }, [applyBatchResult, pasteText]);

  const handleTextFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setPasteText(text);
      setPasteError(null);
    };
    reader.onerror = () => {
      setPasteError("Could not read text file.");
    };
    reader.readAsText(file);
  }, []);

  const handleRowClick = useCallback(
    (row: InvoiceOfflinePreviewRow) => {
      if (!batchResult || !row.processing) return;
      const pageResult = batchResult.results.find((r) => r.pageId === row.pageId);
      if (!pageResult) return;
      const synthetic = buildOfflineImportReviewFromPageResult(batchResult, pageResult);
      if (synthetic) setInspectImport(synthetic);
    },
    [batchResult],
  );

  const summary = batchResult?.summary;

  return (
    <>
      <div data-testid="invoice-offline-batch-panel" style={{ fontFamily: FONT, ...CARD_STYLE }}>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #e0e3e8",
          }}
        >
          <div style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>
            Offline batch preview (Slice 3)
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", margin: "6px 0 0" }}>
            Local only — runs the Slice 1–2 parser in your browser. Does not write to Firestore
            or call Cloud Functions.
          </p>
        </div>

        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e0e3e8" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              data-testid="invoice-offline-run-sample"
              style={PRIMARY_BUTTON}
              onClick={runSample}
            >
              Run sample 8-page batch
            </button>
            <button type="button" style={SECONDARY_BUTTON} onClick={runCorruptSample}>
              Run corrupt-page isolation sample
            </button>
          </div>

          <label
            htmlFor="invoice-offline-paste"
            style={{ display: "block", fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 6 }}
          >
            Paste concatenated extracted text
          </label>
          <textarea
            id="invoice-offline-paste"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder="One page per block, or use ---INVOICE PAGE--- between pages"
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: 12,
              fontFamily: "monospace",
              padding: 10,
              borderRadius: 4,
              border: "1px solid #d1d5db",
              resize: "vertical",
            }}
          />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <button
              type="button"
              data-testid="invoice-offline-process-paste"
              style={PRIMARY_BUTTON}
              onClick={processPaste}
            >
              Process paste
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              style={{ display: "none" }}
              onChange={(e) => {
                handleTextFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              style={SECONDARY_BUTTON}
              onClick={() => fileInputRef.current?.click()}
            >
              Load .txt file
            </button>
          </div>
          {pasteError && (
            <p style={{ color: RED, fontSize: 12, margin: "8px 0 0" }}>
              {pasteError}
            </p>
          )}
        </div>

        {summary && (
          <div
            data-testid="invoice-offline-summary"
            style={{
              padding: "12px 16px",
              borderBottom: previewRows.length > 0 ? "1px solid #e0e3e8" : undefined,
              fontSize: 13,
              color: NAVY,
            }}
          >
            <span style={{ fontWeight: 700 }}>Summary: </span>
            processed {summary.processed} · needs review {summary.needsReview} · failed{" "}
            {summary.failed} · total {summary.total}
          </div>
        )}

        {previewRows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Outcome</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Page</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Invoice #</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Customer P/O</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Fulfillment</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Import status</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Confidence</th>
                  <th style={{ padding: "10px 12px", color: "#6b7280", fontWeight: 600 }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr
                    key={row.pageId}
                    data-testid={`invoice-offline-row-${row.pageId}`}
                    onClick={() => handleRowClick(row)}
                    style={{
                      borderTop: "1px solid #e0e3e8",
                      cursor: row.processing ? "pointer" : "default",
                    }}
                    title={row.processing ? "Click to inspect parsed fields" : undefined}
                  >
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          ...outcomeChipStyle(row.outcome),
                          fontWeight: 700,
                          fontSize: 11,
                          padding: "3px 8px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.outcomeLabel}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: NAVY }}>{row.pageId}</td>
                    <td style={{ padding: "10px 12px", color: "#111827" }}>{row.vendorInvoiceNumber}</td>
                    <td style={{ padding: "10px 12px", color: "#111827" }}>{row.customerPoOrReference}</td>
                    <td style={{ padding: "10px 12px", color: "#111827" }}>{row.fulfillmentLabel}</td>
                    <td style={{ padding: "10px 12px", color: "#111827" }}>{row.importStatusLabel}</td>
                    <td style={{ padding: "10px 12px", color: "#111827" }}>{formatConfidence(row)}</td>
                    <td style={{ padding: "10px 12px", color: RED, maxWidth: 200 }}>
                      {row.errorMessage ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inspectImport && (
        <InvoiceParsedInspectModal
          importRow={inspectImport}
          readOnly
          onClose={() => setInspectImport(null)}
        />
      )}
    </>
  );
}
