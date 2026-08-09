/**
 * Invoice Review — Will-Call → Vendor Drop-Off fulfillment override (human, pending_review only).
 */
import type { Firestore } from "firebase-admin/firestore";
import { deriveImportStatus } from "../inferImportStatus";
import { asParsedHeaderForImport } from "../parsedHeaderValidation";
import type { VendorInvoiceImportDoc } from "../../inboundEmail/types";
import type { ParsedJohnstoneInvoice, InvoiceFulfillmentMethod } from "../types";
import {
  reconcileImportStateAfterCorrection,
  type ReconciledImportState,
} from "../reviewChat/reconcileAfterFieldCorrection";

const REVIEW_COLLECTION = "vendorInvoiceImports";

export class FulfillmentOverrideInputError extends Error {
  code:
    | "invalid-argument"
    | "not-found"
    | "failed-precondition";
  constructor(code: FulfillmentOverrideInputError["code"], message: string) {
    super(message);
    this.name = "FulfillmentOverrideInputError";
    this.code = code;
  }
}

export type InvoiceFulfillmentOverrideRecord = {
  active: true;
  fromMethod: "will_call_pickup";
  toMethod: "delivery";
  at: string;
  by: string;
};

export type SetInvoiceReviewFulfillmentOverrideResult = {
  vendorInvoiceImportId: string;
  applied: boolean;
  alreadyApplied: boolean;
  parsedHeader: Record<string, unknown>;
  importStatus: string;
  previousImportStatus: string;
  fulfillmentOverride: InvoiceFulfillmentOverrideRecord;
  reviewStatus: string;
  parseWarnings: string[];
  autoImportEligible: boolean;
  autoImportConfidence: number;
  autoImportReasons: string[];
  reviewRequiredReasons: string[];
  importDecisionMode: ReconciledImportState["importDecisionMode"];
  suggestedAction: string;
};

function isoNow(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function headerFulfillmentMethod(
  parsedHeader: Record<string, unknown>,
): string | undefined {
  const fm = parsedHeader.fulfillmentMethod;
  return fm === "delivery" ||
    fm === "will_call_pickup" ||
    fm === "unknown"
    ? fm
    : undefined;
}

function buildParsedForDeriveStatus(
  importDoc: Record<string, unknown>,
  parsedHeader: Record<string, unknown>,
): ParsedJohnstoneInvoice {
  const parseWarnings = Array.isArray(importDoc.parseWarnings)
    ? (importDoc.parseWarnings as string[])
    : [];
  const parsedLines = Array.isArray(importDoc.parsedLines)
    ? (importDoc.parsedLines as ParsedJohnstoneInvoice["lines"])
    : [];
  let header: ParsedJohnstoneInvoice["header"];
  try {
    header = asParsedHeaderForImport(parsedHeader);
  } catch {
    const fm = (headerFulfillmentMethod(parsedHeader) ??
      "unknown") as InvoiceFulfillmentMethod;
    header = {
      ...(parsedHeader as unknown as ParsedJohnstoneInvoice["header"]),
      fulfillmentMethod: fm,
    };
  }
  return {
    header,
    lines: parsedLines,
    parseWarnings,
    orderNotes: Array.isArray(importDoc.orderNotes)
      ? (importDoc.orderNotes as string[])
      : [],
  };
}

function maybeRecomputeImportStatus(
  currentStatus: string,
  importDoc: Record<string, unknown>,
  parsedHeader: Record<string, unknown>,
): string {
  if (currentStatus !== "pickup_at_vendor") return currentStatus;
  const formatId =
    importDoc.parserFormatId === "johnstone" ||
    importDoc.parserFormatId === "first_supply" ||
    importDoc.parserFormatId === "generic" ||
    importDoc.parserFormatId === "unknown"
      ? importDoc.parserFormatId
      : "johnstone";
  const parsed = buildParsedForDeriveStatus(importDoc, parsedHeader);
  return deriveImportStatus(parsed, formatId);
}

function resultFromDoc(
  importId: string,
  importDoc: Record<string, unknown>,
  parsedHeader: Record<string, unknown>,
  importStatus: string,
  previousImportStatus: string,
  fulfillmentOverride: InvoiceFulfillmentOverrideRecord,
  applied: boolean,
  alreadyApplied: boolean,
): SetInvoiceReviewFulfillmentOverrideResult {
  const reconciled = reconcileImportStateAfterCorrection({
    parsedHeader,
    parseWarnings: importDoc.parseWarnings,
    importStatus,
    confidenceScore: importDoc.confidenceScore,
    humanReviewRequired: importDoc.humanReviewRequired,
    duplicate: importDoc.duplicate,
    parsedLines: importDoc.parsedLines,
    parsedLineCount: importDoc.parsedLineCount,
    pageId: importDoc.pageId,
    parserFormatId: importDoc.parserFormatId,
    orderNotes: importDoc.orderNotes,
    fieldCorrectionLog: importDoc.fieldCorrectionLog,
  });
  return {
    vendorInvoiceImportId: importId,
    applied,
    alreadyApplied,
    parsedHeader: reconciled.parsedHeader,
    importStatus,
    previousImportStatus,
    fulfillmentOverride,
    reviewStatus:
      typeof importDoc.reviewStatus === "string" ? importDoc.reviewStatus : "",
    parseWarnings: reconciled.parseWarnings,
    autoImportEligible: reconciled.autoImportEligible,
    autoImportConfidence: reconciled.autoImportConfidence,
    autoImportReasons: reconciled.autoImportReasons,
    reviewRequiredReasons: reconciled.reviewRequiredReasons,
    importDecisionMode: reconciled.importDecisionMode,
    suggestedAction: reconciled.suggestedAction,
  };
}

function parseActiveOverride(
  raw: unknown,
): InvoiceFulfillmentOverrideRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.active !== true) return null;
  if (o.fromMethod !== "will_call_pickup" || o.toMethod !== "delivery") return null;
  const at = typeof o.at === "string" ? o.at : "";
  const by = typeof o.by === "string" ? o.by : "";
  if (!at || !by) return null;
  return {
    active: true,
    fromMethod: "will_call_pickup",
    toMethod: "delivery",
    at,
    by,
  };
}

export async function runSetInvoiceReviewFulfillmentOverrideCore(input: {
  db: Firestore;
  uid: string;
  vendorInvoiceImportId: string;
  toFulfillmentMethod: "delivery";
  idempotencyKey: string;
}): Promise<SetInvoiceReviewFulfillmentOverrideResult> {
  const importId = input.vendorInvoiceImportId.trim();
  const idempotencyKey = input.idempotencyKey.trim();

  if (!importId || importId.length > 256) {
    throw new FulfillmentOverrideInputError(
      "invalid-argument",
      "Invalid vendorInvoiceImportId.",
    );
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new FulfillmentOverrideInputError(
      "invalid-argument",
      "Invalid idempotencyKey.",
    );
  }
  if (input.toFulfillmentMethod !== "delivery") {
    throw new FulfillmentOverrideInputError(
      "invalid-argument",
      "toFulfillmentMethod must be delivery.",
    );
  }

  const importRef = input.db.collection(REVIEW_COLLECTION).doc(importId);
  const importSnap = await importRef.get();
  if (!importSnap.exists) {
    throw new FulfillmentOverrideInputError("not-found", "Invoice import not found.");
  }

  const importDoc = importSnap.data() as VendorInvoiceImportDoc & Record<string, unknown>;
  const reviewStatus = importDoc.reviewStatus;
  if (reviewStatus !== "pending_review") {
    throw new FulfillmentOverrideInputError(
      "failed-precondition",
      "import_not_pending_review",
    );
  }

  const parsedHeader = asRecord(importDoc.parsedHeader);
  const currentMethod = headerFulfillmentMethod(parsedHeader);
  const existingOverride = parseActiveOverride(importDoc.fulfillmentOverride);

  if (existingOverride) {
    return resultFromDoc(
      importId,
      importDoc,
      parsedHeader,
      typeof importDoc.importStatus === "string" ? importDoc.importStatus : "pending",
      typeof importDoc.importStatus === "string" ? importDoc.importStatus : "pending",
      existingOverride,
      false,
      true,
    );
  }

  if (currentMethod !== "will_call_pickup") {
    throw new FulfillmentOverrideInputError(
      "failed-precondition",
      "fulfillment_override_requires_will_call",
    );
  }

  const appliedAt = isoNow();
  const previousImportStatus =
    typeof importDoc.importStatus === "string" && importDoc.importStatus.trim()
      ? importDoc.importStatus
      : "pending";

  const fulfillmentOverride: InvoiceFulfillmentOverrideRecord = {
    active: true,
    fromMethod: "will_call_pickup",
    toMethod: "delivery",
    at: appliedAt,
    by: input.uid,
  };

  const nextHeader: Record<string, unknown> = {
    ...parsedHeader,
    fulfillmentMethod: "delivery",
  };

  const updatePayload: Record<string, unknown> = {
    "parsedHeader.fulfillmentMethod": "delivery",
    fulfillmentOverride,
    updatedAt: appliedAt,
  };

  if (!importDoc.originalParsedHeader) {
    updatePayload.originalParsedHeader = { ...parsedHeader };
  }

  const nextImportStatus = maybeRecomputeImportStatus(
    previousImportStatus,
    importDoc,
    nextHeader,
  );
  updatePayload.importStatus = nextImportStatus;

  const reconciled = reconcileImportStateAfterCorrection({
    parsedHeader: nextHeader,
    parseWarnings: importDoc.parseWarnings,
    importStatus: nextImportStatus,
    confidenceScore: importDoc.confidenceScore,
    humanReviewRequired: importDoc.humanReviewRequired,
    duplicate: importDoc.duplicate,
    parsedLines: importDoc.parsedLines,
    parsedLineCount: importDoc.parsedLineCount,
    pageId: importDoc.pageId,
    parserFormatId: importDoc.parserFormatId,
    orderNotes: importDoc.orderNotes,
    fieldCorrectionLog: importDoc.fieldCorrectionLog,
  });

  updatePayload.parseWarnings = reconciled.parseWarnings;
  updatePayload.autoImportEligible = reconciled.autoImportEligible;
  updatePayload.autoImportConfidence = reconciled.autoImportConfidence;
  updatePayload.autoImportReasons = reconciled.autoImportReasons;
  updatePayload.reviewRequiredReasons = reconciled.reviewRequiredReasons;
  updatePayload.importDecisionMode = reconciled.importDecisionMode;
  updatePayload.suggestedAction = reconciled.suggestedAction;

  await importRef.update(updatePayload);

  const mergedDoc = {
    ...importDoc,
    parsedHeader: nextHeader,
    importStatus: nextImportStatus,
    fulfillmentOverride,
    parseWarnings: reconciled.parseWarnings,
    autoImportEligible: reconciled.autoImportEligible,
    autoImportConfidence: reconciled.autoImportConfidence,
    autoImportReasons: reconciled.autoImportReasons,
    reviewRequiredReasons: reconciled.reviewRequiredReasons,
    importDecisionMode: reconciled.importDecisionMode,
    suggestedAction: reconciled.suggestedAction,
    originalParsedHeader:
      importDoc.originalParsedHeader ?? (updatePayload.originalParsedHeader as Record<string, unknown>),
  };

  return resultFromDoc(
    importId,
    mergedDoc,
    nextHeader,
    nextImportStatus,
    previousImportStatus,
    fulfillmentOverride,
    true,
    false,
  );
}
