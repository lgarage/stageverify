import type { VendorInvoiceImportReview } from "./models";

export function invoiceShellBackfillCandidate(
  row: Pick<VendorInvoiceImportReview, "reviewStatus" | "importStatus">,
): boolean {
  return row.reviewStatus === "approved" && row.importStatus !== "issue";
}

export type ShellBackfillEnsureResult = {
  linkedCount: number;
  failedCount?: number;
  errors: string[];
};

/**
 * Fire-and-forget invoice shell backfill — returns immediately.
 * Caller supplies ensure/list deps (Firestore/CF live in firestoreService).
 */
export function scheduleInvoiceShellBackfill(
  imports: VendorInvoiceImportReview[],
  onSettled: (result: {
    items: VendorInvoiceImportReview[] | null;
    errors: string[];
  }) => void,
  deps: {
    ensure: (
      imports: VendorInvoiceImportReview[],
    ) => Promise<ShellBackfillEnsureResult>;
    list: (q: {
      limit: number;
    }) => Promise<VendorInvoiceImportReview[]>;
  },
): void {
  void deps
    .ensure(imports)
    .then(async ({ linkedCount, errors }) => {
      if (linkedCount > 0) {
        const refreshed = await deps.list({ limit: 50 });
        refreshed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        onSettled({ items: refreshed, errors });
        return;
      }
      onSettled({ items: null, errors });
    })
    .catch((err: unknown) => {
      onSettled({
        items: null,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    });
}
