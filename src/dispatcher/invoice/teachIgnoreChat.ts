/**
 * Teach-chat helpers for "ignore this document type from now on" consent UX.
 */
import {
  documentTypeLabel,
  inferDocumentType,
  type JohnstoneDocumentType,
} from "./inferDocumentType";
import type { VendorInvoiceImportReview } from "../models";

export type TeachChatPhase = "idle" | "pending_confirm" | "clarifying";

export type TeachIgnoreFingerprint = {
  vendorKey: string;
  parserFormatId: string;
  documentType: JohnstoneDocumentType;
  documentTypeLabel: string;
};

export type TeachIntent =
  | { kind: "ignore_document_type" }
  | { kind: "ambiguous"; echo: string }
  | { kind: "playbook_lesson" };

export function isTeachConsentYes(text: string): boolean {
  return /^\s*(yes|y|yeah|yep|confirm|confirmed|that's right|thats right|correct|ok|okay)\s*\.?$/i.test(
    text.trim(),
  );
}

export function isTeachConsentNo(text: string): boolean {
  return /^\s*(no|n|nope|cancel|never\s*mind|nevermind)\s*\.?$/i.test(
    text.trim(),
  );
}

/** Any ignore-from-now-on intent (not limited to CREDIT wording). */
export function noteTeachesIgnoreFromNowOn(note: string): boolean {
  const n = note.trim();
  if (!n) return false;
  if (!/\b(ignore|skip|dismiss)\b/i.test(n)) return false;
  return /\b(these|this|those|kind|type|email|invoice|memo|document|from now on|future|always|similar)\b/i.test(
    n,
  );
}

function sanitizeVendorKeyForTeach(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Ignore rules cannot arm for unknown vendor — matches CF isArmableVendorKey. */
export function isArmableVendorKeyForTeach(raw: string): boolean {
  const key = sanitizeVendorKeyForTeach(raw);
  return key.length > 0 && key !== "unknown-vendor";
}

export function fingerprintForImport(
  importRow: VendorInvoiceImportReview,
  vendorDisplayName: string,
): TeachIgnoreFingerprint {
  const documentType = inferDocumentType(importRow);
  const parserFormatId =
    importRow.parserFormatId === "johnstone" ||
    importRow.parserFormatId === "first_supply" ||
    importRow.parserFormatId === "generic"
      ? importRow.parserFormatId
      : "unknown";
  const vendorKey =
    sanitizeVendorKeyForTeach(
      (typeof importRow.detectedVendorName === "string" &&
        importRow.detectedVendorName.trim()) ||
        vendorDisplayName.trim() ||
        (parserFormatId === "johnstone" ? "johnstone" : "unknown-vendor"),
    ) || "unknown-vendor";
  return {
    vendorKey,
    parserFormatId,
    documentType,
    documentTypeLabel: documentTypeLabel(documentType),
  };
}

function buildIgnoreEcho(fp: TeachIgnoreFingerprint, vendorLabel: string): string {
  const base = `I think you mean: automatically skip future ${fp.documentTypeLabel} imports for ${vendorLabel} (format: ${fp.parserFormatId}) so they don't need review.`;
  if (fp.documentType === "invoice") {
    return `${base} WARNING: This will skip future INVOICES — real invoices will not enter the review queue. Reply yes to confirm anyway, or no to cancel.`;
  }
  return `${base} Reply yes to confirm.`;
}

/** @deprecated Display-only — authoritative echo comes from proposeVendorIgnoreRule (D-59 P1). */
export function buildClientIgnoreEchoPreview(
  importRow: VendorInvoiceImportReview,
  vendorDisplayName: string,
): string {
  const fingerprint = fingerprintForImport(importRow, vendorDisplayName);
  const vendor = vendorDisplayName.trim() || "this vendor";
  return buildIgnoreEcho(fingerprint, vendor);
}

export function interpretTeachNote(
  note: string,
  vendorDisplayName: string,
  importRow?: VendorInvoiceImportReview,
): TeachIntent {
  const trimmed = note.trim();
  if (!trimmed) return { kind: "playbook_lesson" };

  const vendor = vendorDisplayName.trim() || "this vendor";

  if (noteTeachesIgnoreFromNowOn(trimmed) && importRow) {
    const fingerprint = fingerprintForImport(importRow, vendorDisplayName);
    if (!isArmableVendorKeyForTeach(fingerprint.vendorKey)) {
      return {
        kind: "ambiguous",
        echo: `I can't arm an ignore rule until this import has a known vendor name (not "unknown vendor"). Link or confirm the vendor first, then try again.`,
      };
    }
    return { kind: "ignore_document_type" };
  }

  if (noteTeachesIgnoreFromNowOn(trimmed) && !importRow) {
    return {
      kind: "ambiguous",
      echo: `I can auto-skip this document type for ${vendor} from now on. Open a Parsed import row and try again, or reply yes after I echo the type.`,
    };
  }

  if (/\b(ignore|skip|dismiss)\b/i.test(trimmed)) {
    return {
      kind: "ambiguous",
      echo: `I can auto-skip future documents that match this one's type for ${vendor}. Say "ignore these from now on" and I'll confirm the type.`,
    };
  }

  return { kind: "playbook_lesson" };
}
