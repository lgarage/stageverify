import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { loadEmailMatchContext } from "../email/loadMatchContext";
import { buildExpectedItemsFromImport } from "./buildExpectedItemsFromImport";
import { deliveryStatusFromImportStatus } from "./deliveryStatusFromImportStatus";
import { matchInvoiceToRecords } from "./matchInvoiceToRecords";
import type { ParsedInvoiceHeader } from "./types";
import type { VendorInvoiceImportDoc } from "../inboundEmail/types";

export const SHELL_DELIVERY_ID_PREFIX = "delivery-vii-";

export function shellDeliveryIdForImport(importId: string): string {
  return `${SHELL_DELIVERY_ID_PREFIX}${importId}`;
}

function asParsedHeader(raw: Record<string, unknown>): ParsedInvoiceHeader {
  const str = (key: string, required = false): string => {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (required) throw new HttpsError("failed-precondition", `Invoice header missing ${key}.`);
    return "";
  };
  return {
    customerAccountNumber: str("customerAccountNumber", true),
    vendorOrderNumber: str("vendorOrderNumber", true),
    vendorInvoiceNumber: str("vendorInvoiceNumber", true),
    customerPoOrReference: str("customerPoOrReference", true),
    quoteNumber: str("quoteNumber") || undefined,
    orderDate: str("orderDate", true),
    invoiceDate: str("invoiceDate"),
    shipDate: str("shipDate"),
    buyerName: str("buyerName") || undefined,
    shipViaRaw: str("shipViaRaw") || undefined,
    jobNumberRaw: str("jobNumberRaw") || undefined,
    vendorBranchName: str("vendorBranchName", true),
    vendorBranchAddress: str("vendorBranchAddress"),
    vendorBranchPhone: str("vendorBranchPhone"),
    soldToName: str("soldToName"),
    shipToName: str("shipToName"),
    shipToAddress: str("shipToAddress"),
    fulfillmentMethod:
      raw.fulfillmentMethod === "delivery" ||
      raw.fulfillmentMethod === "will_call_pickup" ||
      raw.fulfillmentMethod === "unknown"
        ? raw.fulfillmentMethod
        : "unknown",
    shipCompletePolicy:
      raw.shipCompletePolicy === "hold_until_complete" ||
      raw.shipCompletePolicy === "allow_partial" ||
      raw.shipCompletePolicy === "unknown"
        ? raw.shipCompletePolicy
        : "unknown",
  };
}

async function resolveJohnstoneVendor(
  db: Firestore,
): Promise<{ id: string; name: string } | null> {
  const snap = await db.collection("vendors").limit(100).get();
  for (const doc of snap.docs) {
    const name = doc.data().name;
    if (typeof name === "string" && /johnstone/i.test(name)) {
      return { id: doc.id, name };
    }
  }
  if (!snap.empty) {
    const doc = snap.docs[0];
    const name = doc.data().name;
    return {
      id: doc.id,
      name: typeof name === "string" ? name : "Vendor",
    };
  }
  return null;
}

function resolveJobIdFromHints(
  header: ParsedInvoiceHeader,
  ctx: Awaited<ReturnType<typeof loadEmailMatchContext>>,
  matchJobId?: string,
): string | undefined {
  if (matchJobId) return matchJobId;

  const customerPo = header.customerPoOrReference.toUpperCase();
  const jobHint = header.jobNumberRaw?.trim().toUpperCase() ?? "";

  if (jobHint) {
    const exact = ctx.jobs.filter((j) => j.jobNumber.toUpperCase() === jobHint);
    if (exact.length === 1) return exact[0].id;
  }

  for (const job of ctx.jobs) {
    const num = job.jobNumber.toUpperCase();
    if (num && customerPo.includes(num)) return job.id;
  }

  return undefined;
}

export interface InvoiceShellContext {
  deliveryOrderId: string;
  jobId: string;
  vendorId: string;
  vendorName: string;
  purchaseOrderId?: string;
  orderNumber: string;
  deliveryDate: string;
  expectedItems: ReturnType<typeof buildExpectedItemsFromImport>;
  evidenceNote: string;
  vendorInvoiceNumber: string;
  vendorOrderNumber: string;
  customerPo: string;
  deliveryStatus: ReturnType<typeof deliveryStatusFromImportStatus>;
}

/** Resolve job/vendor + line items for a dashboard shell — throws when job cannot be matched. */
export async function buildInvoiceDeliveryShellContext(
  db: Firestore,
  importId: string,
  importDoc: VendorInvoiceImportDoc,
): Promise<InvoiceShellContext> {
  const header = asParsedHeader(importDoc.parsedHeader);
  const ctx = await loadEmailMatchContext();
  const match = matchInvoiceToRecords(importId, header, ctx);

  const jobId = resolveJobIdFromHints(header, ctx, match.jobId);
  if (!jobId) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot create dashboard record — no matching job found. Link to an existing delivery instead.",
    );
  }

  let vendorId = match.vendorId;
  let vendorName = "Vendor";
  if (vendorId) {
    const vendorSnap = await db.collection("vendors").doc(vendorId).get();
    if (vendorSnap.exists) {
      const name = vendorSnap.data()?.name;
      if (typeof name === "string") vendorName = name;
    }
  } else {
    const resolved = await resolveJohnstoneVendor(db);
    if (!resolved) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot create dashboard record — no vendor record found.",
      );
    }
    vendorId = resolved.id;
    vendorName = resolved.name;
  }

  const deliveryOrderId = shellDeliveryIdForImport(importId);
  const expectedItems = buildExpectedItemsFromImport(
    importId,
    deliveryOrderId,
    jobId,
    importDoc.parsedLines ?? [],
  );

  if (expectedItems.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "No expected product lines to apply.",
    );
  }

  const vendorInvoiceNumber = header.vendorInvoiceNumber;
  const vendorOrderNumber = header.vendorOrderNumber;
  const customerPo = header.customerPoOrReference;
  const evidenceNote = `Imported from Johnstone invoice ${vendorInvoiceNumber || vendorOrderNumber} (Customer P/O: ${customerPo}). Invoice import shell — no shop receipt.`;

  const deliveryDate =
    header.shipDate?.trim() ||
    header.invoiceDate?.trim() ||
    header.orderDate?.trim() ||
    new Date().toISOString().slice(0, 10);

  const orderNumber = vendorOrderNumber || vendorInvoiceNumber || deliveryOrderId;

  return {
    deliveryOrderId,
    jobId,
    vendorId,
    vendorName,
    purchaseOrderId: match.purchaseOrderId,
    orderNumber,
    deliveryDate,
    expectedItems,
    evidenceNote,
    vendorInvoiceNumber,
    vendorOrderNumber,
    customerPo,
    deliveryStatus: deliveryStatusFromImportStatus(importDoc.importStatus),
  };
}

/** Fields for a new delivery shell — no staging, readiness, or pickup side effects. */
export function buildDeliveryShellDocument(
  shell: InvoiceShellContext,
  importId: string,
  importDoc: VendorInvoiceImportDoc,
  now: string,
): Record<string, unknown> {
  return {
    id: shell.deliveryOrderId,
    orderNumber: shell.orderNumber,
    jobId: shell.jobId,
    vendorId: shell.vendorId,
    vendorName: shell.vendorName,
    ...(shell.purchaseOrderId ? { purchaseOrderId: shell.purchaseOrderId } : {}),
    deliveryDate: shell.deliveryDate,
    status: shell.deliveryStatus,
    vendorInvoiceImportId: importId,
    invoiceImportStatus: importDoc.importStatus,
    vendorOrderComplete: true,
    vendorOrderCompleteAt: now,
    vendorOrderCompleteSource: "vendor_email",
    ...(shell.vendorInvoiceNumber
      ? { vendorInvoiceNumber: shell.vendorInvoiceNumber }
      : {}),
    ...(shell.vendorOrderNumber ? { vendorOrderNumber: shell.vendorOrderNumber } : {}),
    ...(shell.customerPo ? { customerPoOrReference: shell.customerPo } : {}),
    notes: shell.evidenceNote,
    createdAt: now,
    updatedAt: now,
  };
}
