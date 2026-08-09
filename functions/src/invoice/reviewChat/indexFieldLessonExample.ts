/**
 * Lane C C3-C.1 — index verified C2 corrections as inert reusable-learning EXAMPLES.
 *
 * NO parse effect. Never throw to the C2 apply caller.
 * Distinct-document identity: sourceDocumentKey = vendorInvoiceImportId (C3-D must
 * count DISTINCT sourceDocumentKeys, not correction-event cardinality).
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { sanitizeVendorKey } from "../aiShadow/vendorTrainingMd";
import { isArmableVendorKey } from "../aiShadow/vendorIgnoreRules";
import {
  extractSenderDomain,
  normalizeSenderDomains,
} from "../vendorIgnoreEcho";
import {
  isCorrectableFieldKey,
  type InvoiceCorrectableFieldKey,
  type ReviewCorrectionSourceType,
} from "./correctionAllowlist";

export const FIELD_LESSON_EXAMPLE_COLLECTION = "vendorInvoiceFieldLessonExamples";
export const FIELD_LESSON_EXAMPLE_RETENTION_DAYS = 365;
export const FIELD_LESSON_EXAMPLE_CATEGORY = "header_field_extraction" as const;

const MAX_INDEX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 40;

export type FieldLessonExampleSkipReason =
  | "field_not_allowed"
  | "vendor_not_armable"
  | "format_unknown"
  | "sender_domain_unavailable"
  | "missing_import_id"
  | "missing_correction_id";

export type FieldLessonExampleDoc = {
  id: string;
  exampleId: string;
  correctionId: string;
  vendorInvoiceImportId: string;
  /** Stable document identity for future C3-D distinct-document counting. */
  sourceDocumentKey: string;
  sourceChatMessageId: string;
  category: typeof FIELD_LESSON_EXAMPLE_CATEGORY;
  field: InvoiceCorrectableFieldKey;
  vendorKey: string;
  parserFormatId: "johnstone" | "first_supply" | "generic";
  senderDomain: string;
  originalValue: string;
  correctedValue: string;
  evidenceType: ReviewCorrectionSourceType;
  evidenceCitationText?: string;
  evidenceSpanStart?: number;
  evidenceSpanEnd?: number;
  actorUid: string;
  verifiedAt: string;
  /** Written as FieldValue.serverTimestamp(); stored as Timestamp. */
  verifiedAtServer: Timestamp | ReturnType<typeof FieldValue.serverTimestamp>;
  status: "active";
  retentionDays: number;
  /** Native Firestore Timestamp — required for TTL policy (ISO string will NOT TTL). */
  expireAt: Timestamp;
  scopeKey: string;
  source: "c2_verified_correction";
  idempotencyKey: string;
};

export type FieldLessonExampleWriteDoc = FieldLessonExampleDoc;

export type BuildFieldLessonExampleResult =
  | { ok: true; doc: FieldLessonExampleWriteDoc }
  | { ok: false; reason: FieldLessonExampleSkipReason };

export type IndexFieldLessonExampleResult =
  | { indexed: true; exampleId: string; alreadyExisted?: boolean }
  | { indexed: false; reason: FieldLessonExampleSkipReason | "write_failed" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 6 || e.code === "already-exists" || e.code === "ALREADY_EXISTS") {
    return true;
  }
  const msg = typeof e.message === "string" ? e.message : "";
  return /ALREADY_EXISTS|already.?exists/i.test(msg);
}

function normalizeParserFormatId(
  raw: unknown,
): "johnstone" | "first_supply" | "generic" | null {
  if (raw === "johnstone" || raw === "first_supply" || raw === "generic") {
    return raw;
  }
  return null;
}

/**
 * Resolve vendorKey for C3-C scoping — NEVER invent from parserFormatId
 * (vendorKeyFromImportDoc johnstone fallback is forbidden here).
 */
export function resolveArmableVendorKeyFromDetectedName(
  detectedVendorName: unknown,
): string | null {
  if (typeof detectedVendorName !== "string" || !detectedVendorName.trim()) {
    return null;
  }
  const key = sanitizeVendorKey(detectedVendorName);
  if (!isArmableVendorKey(key)) return null;
  return key;
}

export function buildScopeKey(input: {
  vendorKey: string;
  parserFormatId: string;
  senderDomain: string;
  field: string;
}): string {
  return `${input.vendorKey}__${input.parserFormatId}__${input.senderDomain}__${input.field}`;
}

export function buildExpireAtTimestamp(
  verifiedAtMs: number,
  retentionDays = FIELD_LESSON_EXAMPLE_RETENTION_DAYS,
): Timestamp {
  return Timestamp.fromMillis(verifiedAtMs + retentionDays * 86_400_000);
}

/** Pure builder — unit-testable; no I/O. */
export function buildFieldLessonExampleFromApply(input: {
  correctionId: string;
  vendorInvoiceImportId: string;
  sourceChatMessageId: string;
  field: unknown;
  originalValue: string;
  correctedValue: string;
  evidenceType: ReviewCorrectionSourceType;
  evidenceCitationText?: string;
  evidenceSpanStart?: number;
  evidenceSpanEnd?: number;
  actorUid: string;
  detectedVendorName: unknown;
  parserFormatId: unknown;
  senderDomain: string;
  verifiedAt?: string;
}): BuildFieldLessonExampleResult {
  const importId = input.vendorInvoiceImportId.trim();
  const correctionId = input.correctionId.trim();
  if (!importId) return { ok: false, reason: "missing_import_id" };
  if (!correctionId) return { ok: false, reason: "missing_correction_id" };
  if (!isCorrectableFieldKey(input.field)) {
    return { ok: false, reason: "field_not_allowed" };
  }
  const vendorKey = resolveArmableVendorKeyFromDetectedName(
    input.detectedVendorName,
  );
  if (!vendorKey) return { ok: false, reason: "vendor_not_armable" };
  const parserFormatId = normalizeParserFormatId(input.parserFormatId);
  if (!parserFormatId) return { ok: false, reason: "format_unknown" };
  const senderDomain = input.senderDomain.trim().toLowerCase();
  if (!senderDomain) return { ok: false, reason: "sender_domain_unavailable" };

  const verifiedAt = input.verifiedAt ?? new Date().toISOString();
  const verifiedAtMs = Date.parse(verifiedAt);
  const expireBaseMs = Number.isFinite(verifiedAtMs)
    ? verifiedAtMs
    : Date.now();
  const scopeKey = buildScopeKey({
    vendorKey,
    parserFormatId,
    senderDomain,
    field: input.field,
  });

  const doc: FieldLessonExampleWriteDoc = {
    id: correctionId,
    exampleId: correctionId,
    correctionId,
    vendorInvoiceImportId: importId,
    sourceDocumentKey: importId,
    sourceChatMessageId: input.sourceChatMessageId.trim(),
    category: FIELD_LESSON_EXAMPLE_CATEGORY,
    field: input.field,
    vendorKey,
    parserFormatId,
    senderDomain,
    originalValue: input.originalValue,
    correctedValue: input.correctedValue,
    evidenceType: input.evidenceType,
    ...(input.evidenceCitationText
      ? { evidenceCitationText: input.evidenceCitationText.slice(0, 500) }
      : {}),
    ...(typeof input.evidenceSpanStart === "number"
      ? { evidenceSpanStart: input.evidenceSpanStart }
      : {}),
    ...(typeof input.evidenceSpanEnd === "number"
      ? { evidenceSpanEnd: input.evidenceSpanEnd }
      : {}),
    actorUid: input.actorUid,
    verifiedAt,
    verifiedAtServer: FieldValue.serverTimestamp(),
    status: "active",
    retentionDays: FIELD_LESSON_EXAMPLE_RETENTION_DAYS,
    expireAt: buildExpireAtTimestamp(expireBaseMs),
    scopeKey,
    source: "c2_verified_correction",
    idempotencyKey: correctionId,
  };

  return { ok: true, doc };
}

async function loadSenderDomain(
  db: Firestore,
  inboundEmailProcessingId: unknown,
): Promise<string | null> {
  const inboundId =
    typeof inboundEmailProcessingId === "string"
      ? inboundEmailProcessingId.trim()
      : "";
  if (!inboundId) return null;
  const snap = await db.collection("inboundEmailProcessing").doc(inboundId).get();
  if (!snap.exists) return null;
  const senderEmail =
    typeof snap.data()?.senderEmail === "string"
      ? (snap.data()!.senderEmail as string)
      : "";
  const domains = normalizeSenderDomains([senderEmail]);
  if (domains.length === 0) {
    // Fallback: extractSenderDomain alone (normalize may reject junk)
    return extractSenderDomain(senderEmail);
  }
  return domains[0] ?? null;
}

/**
 * Best-effort index after successful C2 apply. Never throws to caller.
 * Uses .create() only (immutable). Bounded retries for transient errors.
 */
export async function writeFieldLessonExampleIfEligible(input: {
  db: Firestore;
  correctionId: string;
  vendorInvoiceImportId: string;
  sourceChatMessageId: string;
  field: InvoiceCorrectableFieldKey;
  originalValue: string;
  correctedValue: string;
  evidenceType: ReviewCorrectionSourceType;
  evidenceCitationText?: string;
  evidenceSpanStart?: number;
  evidenceSpanEnd?: number;
  actorUid: string;
  detectedVendorName: unknown;
  parserFormatId: unknown;
  inboundEmailProcessingId: unknown;
  verifiedAt?: string;
}): Promise<IndexFieldLessonExampleResult> {
  try {
    const senderDomain = await loadSenderDomain(
      input.db,
      input.inboundEmailProcessingId,
    );
    if (!senderDomain) {
      console.warn(
        JSON.stringify({
          event: "c3c_example_index_skipped",
          reason: "sender_domain_unavailable",
          correctionId: input.correctionId,
        }),
      );
      return { indexed: false, reason: "sender_domain_unavailable" };
    }

    const built = buildFieldLessonExampleFromApply({
      correctionId: input.correctionId,
      vendorInvoiceImportId: input.vendorInvoiceImportId,
      sourceChatMessageId: input.sourceChatMessageId,
      field: input.field,
      originalValue: input.originalValue,
      correctedValue: input.correctedValue,
      evidenceType: input.evidenceType,
      evidenceCitationText: input.evidenceCitationText,
      evidenceSpanStart: input.evidenceSpanStart,
      evidenceSpanEnd: input.evidenceSpanEnd,
      actorUid: input.actorUid,
      detectedVendorName: input.detectedVendorName,
      parserFormatId: input.parserFormatId,
      senderDomain,
      verifiedAt: input.verifiedAt,
    });

    if (!built.ok) {
      console.warn(
        JSON.stringify({
          event: "c3c_example_index_skipped",
          reason: built.reason,
          correctionId: input.correctionId,
        }),
      );
      return { indexed: false, reason: built.reason };
    }

    const ref = input.db
      .collection(FIELD_LESSON_EXAMPLE_COLLECTION)
      .doc(built.doc.exampleId);

    for (let attempt = 1; attempt <= MAX_INDEX_ATTEMPTS; attempt += 1) {
      try {
        await ref.create(built.doc);
        return { indexed: true, exampleId: built.doc.exampleId };
      } catch (err) {
        if (isAlreadyExistsError(err)) {
          return {
            indexed: true,
            exampleId: built.doc.exampleId,
            alreadyExisted: true,
          };
        }
        if (attempt < MAX_INDEX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        console.warn(
          JSON.stringify({
            event: "c3c_example_index_failed",
            correctionId: input.correctionId,
            attempt,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return { indexed: false, reason: "write_failed" };
      }
    }
    return { indexed: false, reason: "write_failed" };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "c3c_example_index_failed",
        correctionId: input.correctionId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { indexed: false, reason: "write_failed" };
  }
}
