import { useCallback, useId, useState, type ChangeEvent } from "react";
import type { InvoiceBatchResult } from "./types";
import { extractInvoicePdfTextClient } from "./extractInvoicePdfTextClient";
import { processInvoiceBatchFromExtracted } from "./processInvoiceBatch";
import { vendorInvoiceImportDisplayLabelForRow } from "./invoiceDisplayHelpers";
import type { VendorInvoiceImportStatus } from "./types";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function outcomeLabel(outcome: string): string {
  if (outcome === "processed") return "Processed";
  if (outcome === "needs_review") return "Needs review";
  return "Failed";
}

export function InvoicePdfUploadPreview() {
  const inputId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<InvoiceBatchResult | null>(null);

  const runParse = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setBatchResult(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const pages = await extractInvoicePdfTextClient(buffer);
      if (pages.length === 0) {
        throw new Error("No text could be extracted from this PDF.");
      }
      const result = processInvoiceBatchFromExtracted({
        pages: pages.map((extractedText, pageIndex) => ({ pageIndex, extractedText })),
        pageIds: pages.map((_, index) => `upload-page-${index}`),
      });
      setBatchResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF parse failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please choose a PDF file.");
        return;
      }
      void runParse(file);
    },
    [runParse],
  );

  return (
    <section
      data-testid="invoice-pdf-upload-preview"
      style={{
        fontFamily: FONT,
        backgroundColor: "#fff",
        border: "1px solid #e0e3e8",
        borderRadius: 8,
        padding: "16px 18px",
        marginBottom: 16,
      }}
    >
      <h2
        style={{
          margin: "0 0 6px",
          fontSize: 16,
          fontWeight: 700,
          color: NAVY,
        }}
      >
        Upload invoice PDF (preview)
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
        Parses locally — preview only. Nothing is saved to Firestore.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label
          htmlFor={inputId}
          style={{
            display: "inline-block",
            backgroundColor: NAVY,
            color: "#fff",
            fontWeight: 600,
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: 6,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Parsing…" : "Choose PDF"}
        </label>
        <input
          id={inputId}
          data-testid="invoice-pdf-upload-input"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        {fileName && !busy && (
          <span style={{ fontSize: 13, color: "#374151" }}>{fileName}</span>
        )}
      </div>
      {error && (
        <p
          data-testid="invoice-pdf-upload-error"
          style={{ margin: "12px 0 0", fontSize: 13, color: RED, fontWeight: 600 }}
        >
          {error}
        </p>
      )}
      {batchResult && (
        <div data-testid="invoice-pdf-upload-results" style={{ marginTop: 14 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: NAVY, fontWeight: 600 }}>
            Batch {batchResult.importBatchId}: {batchResult.summary.processed} processed ·{" "}
            {batchResult.summary.needsReview} needs review · {batchResult.summary.failed} failed
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              color: "#374151",
            }}
          >
            {batchResult.results.map((row) => {
              const importStatus = row.processing?.importStatus ?? "unknown";
              const label = vendorInvoiceImportDisplayLabelForRow(
                importStatus as VendorInvoiceImportStatus,
                row.processing?.parsed.orderNotes,
              );
              const invoiceNum =
                row.processing?.parsed?.header.vendorInvoiceNumber?.trim() || row.pageId;
              return (
                <li key={row.pageId} data-testid={`invoice-pdf-upload-row-${row.outcome}`}>
                  {invoiceNum} — {outcomeLabel(row.outcome)} ({label})
                  {row.error ? ` — ${row.error}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
