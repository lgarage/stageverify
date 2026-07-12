import { useCallback, useState } from "react";
import { fetchVendorInvoicePdf } from "../firestoreService";
import {
  openBlankPdfViewerTab,
  openVendorInvoicePdfInNewTab,
  vendorInvoicePdfUnavailableMessage,
} from "./invoicePdfClient";

/** Fetch Gmail-stored invoice PDF via CF and open in a new browser tab. */
export function useVendorInvoicePdfViewer() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const viewPdf = useCallback(async (importId: string) => {
    const popup = openBlankPdfViewerTab();
    if (!popup) {
      setErrorById((prev) => ({
        ...prev,
        [importId]:
          "Pop-up blocked — allow pop-ups for StageVerify to view the invoice PDF.",
      }));
      return;
    }

    setLoadingId(importId);
    setErrorById((prev) => {
      if (!prev[importId]) return prev;
      const next = { ...prev };
      delete next[importId];
      return next;
    });
    try {
      const payload = await fetchVendorInvoicePdf(importId);
      if (popup.closed) {
        throw new Error("PDF viewer tab was closed before the invoice could load.");
      }
      openVendorInvoicePdfInNewTab(payload, popup);
    } catch (err) {
      if (!popup.closed) {
        popup.close();
      }
      setErrorById((prev) => ({
        ...prev,
        [importId]: vendorInvoicePdfUnavailableMessage(err),
      }));
    } finally {
      setLoadingId((current) => (current === importId ? null : current));
    }
  }, []);

  return {
    viewPdf,
    isLoading: (importId: string) => loadingId === importId,
    unavailableMessage: (importId: string) => errorById[importId] ?? null,
  };
}
