/**
 * Lane C C2 — reconcile current import state after allowlisted field corrections.
 * Clears resolved missing-field parseWarnings and recomputes eligibility from the
 * authoritative corrected header (does not invent UI-only values).
 */
import {
  eligibilityFieldsFromInput,
  type AutoImportEligibilityResult,
} from "../computeAutoImportEligibility";
import {
  INVOICE_CORRECTABLE_FIELD_KEYS,
  headerFieldAsString,
  isCorrectableFieldKey,
  type InvoiceCorrectableFieldKey,
} from "./correctionAllowlist";

/** Map correctable field → parser "missing <field>" warning token. */
const MISSING_WARNING_BY_FIELD: Record<InvoiceCorrectableFieldKey, string> = {
  customerPoOrReference: "missing customerPoOrReference",
  vendorOrderNumber: "missing vendorOrderNumber",
  vendorInvoiceNumber: "missing vendorInvoiceNumber",
};

export type FieldCorrectionLogEntry = {
  field: string;
  previousValue?: string;
  newValue: string;
  at?: string;
  by?: string;
  correctionId?: string;
};

export type ReconciledImportState = {
  parsedHeader: Record<string, unknown>;
  parseWarnings: string[];
} & Pick<
  AutoImportEligibilityResult,
  | "autoImportEligible"
  | "autoImportConfidence"
  | "autoImportReasons"
  | "reviewRequiredReasons"
  | "importDecisionMode"
  | "suggestedAction"
>;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Drop `missing <field>` warnings when the current header has a non-empty value.
 * Unrelated warnings are preserved (current unresolved issues, not historical audit).
 */
export function reconcileParseWarningsForHeader(
  parseWarnings: unknown,
  parsedHeader: Record<string, unknown>,
): string[] {
  const warnings = Array.isArray(parseWarnings)
    ? parseWarnings.filter((w): w is string => typeof w === "string" && Boolean(w.trim()))
    : [];

  return warnings.filter((warning) => {
    const normalized = warning.trim().toLowerCase();
    for (const field of INVOICE_CORRECTABLE_FIELD_KEYS) {
      const missingToken = MISSING_WARNING_BY_FIELD[field];
      if (normalized === missingToken.toLowerCase()) {
        return !headerFieldAsString(parsedHeader, field);
      }
    }
    return true;
  });
}

/** Re-apply durable fieldCorrectionLog overrides onto a freshly parsed header. */
export function applyFieldCorrectionLogToHeader(
  parsedHeader: Record<string, unknown>,
  fieldCorrectionLog: unknown,
): Record<string, unknown> {
  const next = { ...asRecord(parsedHeader) };
  if (!Array.isArray(fieldCorrectionLog)) return next;

  for (const raw of fieldCorrectionLog) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as FieldCorrectionLogEntry;
    if (!isCorrectableFieldKey(entry.field)) continue;
    const newValue = typeof entry.newValue === "string" ? entry.newValue.trim() : "";
    if (!newValue) continue;
    next[entry.field] = newValue;
  }
  return next;
}

/**
 * Build authoritative post-correction import fields from the corrected header
 * and the rest of the current import document.
 */
export function reconcileImportStateAfterCorrection(input: {
  parsedHeader: Record<string, unknown>;
  parseWarnings?: unknown;
  importStatus?: unknown;
  confidenceScore?: unknown;
  humanReviewRequired?: unknown;
  duplicate?: unknown;
  parsedLines?: unknown;
  parsedLineCount?: unknown;
  pageId?: unknown;
  parserFormatId?: unknown;
  orderNotes?: unknown;
  /** Verified C2 corrections — forwarded so eligibility can skip stale parser-era vetoes. */
  fieldCorrectionLog?: unknown;
}): ReconciledImportState {
  const parsedHeader = asRecord(input.parsedHeader);
  const parseWarnings = reconcileParseWarningsForHeader(
    input.parseWarnings,
    parsedHeader,
  );
  const importStatus =
    typeof input.importStatus === "string" && input.importStatus.trim()
      ? input.importStatus
      : "pending";
  const confidenceScore =
    typeof input.confidenceScore === "number" && Number.isFinite(input.confidenceScore)
      ? input.confidenceScore
      : 0;
  const parserFormatId =
    input.parserFormatId === "johnstone" ||
    input.parserFormatId === "first_supply" ||
    input.parserFormatId === "generic" ||
    input.parserFormatId === "unknown"
      ? input.parserFormatId
      : undefined;

  const parsedLines = Array.isArray(input.parsedLines)
    ? input.parsedLines.filter(
        (line): line is {
          lineType?: string;
          excludeFromExpectedItems?: boolean;
          quantityOrdered?: number;
          quantityShipped?: number;
          quantityBackordered?: number;
        } => Boolean(line && typeof line === "object"),
      )
    : undefined;

  const eligibility = eligibilityFieldsFromInput({
    importStatus,
    confidenceScore,
    humanReviewRequired:
      typeof input.humanReviewRequired === "boolean"
        ? input.humanReviewRequired
        : undefined,
    duplicate: typeof input.duplicate === "boolean" ? input.duplicate : undefined,
    parseWarnings,
    parsedHeader,
    parsedLines,
    parsedLineCount:
      typeof input.parsedLineCount === "number" ? input.parsedLineCount : undefined,
    pageId: typeof input.pageId === "string" ? input.pageId : undefined,
    parserFormatId,
    orderNotes: Array.isArray(input.orderNotes)
      ? input.orderNotes.filter((n): n is string => typeof n === "string")
      : undefined,
    fieldCorrectionLog: input.fieldCorrectionLog,
  });

  return {
    parsedHeader,
    parseWarnings,
    autoImportEligible: eligibility.autoImportEligible,
    autoImportConfidence: eligibility.autoImportConfidence,
    autoImportReasons: eligibility.autoImportReasons,
    reviewRequiredReasons: eligibility.reviewRequiredReasons,
    importDecisionMode: eligibility.importDecisionMode,
    suggestedAction: eligibility.suggestedAction,
  };
}
