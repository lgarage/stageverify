import { useCallback, useState } from "react";
import { fetchVendorInvoicePdf } from "../firestoreService";
import {
  openVendorInvoicePdfInNewTab,
  vendorInvoicePdfUnavailableMessage,
} from "./invoicePdfClient";

/** Fetch Gmail-stored invoice PDF via CF and open in a new browser tab. */
export function useVendorInvoicePdfViewer() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const viewPdf = useCallback(async (importId: string) => {
    setLoadingId(importId);
    setErrorById((prev) => {
      if (!prev[importId]) return prev;
      const next = { ...prev };
      delete next[importId];
      return next;
    });
    try {
      const payload = await fetchVendorInvoicePdf(importId);
      openVendorInvoicePdfInNewTab(payload);
    } catch (err) {
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
