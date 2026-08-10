/**
 * Lane C C3-D — vendorInvoiceFieldLessons collection types (lifecycle control-plane).
 * No parse effect. D.1 evaluator writes proposed | suspended only; D.2 Manager lifecycle adds active | rejected.
 */
import { createHash } from "crypto";
import type { InvoiceCorrectableFieldKey } from "./correctionAllowlist";
import type { CaptureShapeId } from "./patternFingerprint";
import { buildScopeKey } from "./indexFieldLessonExample";

export const FIELD_LESSON_COLLECTION = "vendorInvoiceFieldLessons";
export const FIELD_LESSON_CATEGORY = "header_field_extraction" as const;
export const MIN_DISTINCT_DOCUMENT_VOTES = 3;

export type FieldLessonStatus =
  | "proposed"
  | "active"
  | "suspended"
  | "rejected";

/** @deprecated Use FieldLessonStatus — kept for D.1-era imports */
export type FieldLessonStatusD1 = "proposed" | "suspended";

export type FieldLessonLifecycleAction =
  | "activate"
  | "reject"
  | "suspend"
  | "reactivate";

export type FieldLessonDisabledReason =
  | "contradictory_evidence"
  | "eligible_votes_below_threshold"
  | "superseded_by_winning_pattern"
  | "manual_suspend"
  | "auto_false_positive";

export type FieldLessonExtractionPattern = {
  category: typeof FIELD_LESSON_CATEGORY;
  field: InvoiceCorrectableFieldKey;
  canonicalAnchorKeys: string[];
  matchedLiteralAnchors: string[];
  captureShapeId: CaptureShapeId;
  /** Identity only — C3-E owns fill-empty applicator semantics. */
  captureShapeNote: "bounded_token_near_anchor";
};

export type FieldLessonEvidenceSnapshotVote = {
  sourceDocumentKey: string;
  exampleId: string;
  correctedValue: string;
  verifiedAt: string;
  textWindowHash: string;
  inboundEmailProcessingId: string | null;
  captureShapeId: CaptureShapeId;
  matchedLiteral: string;
};

export type FieldLessonEvidenceSnapshot = {
  distinctSourceDocumentKeys: string[];
  exampleIds: string[];
  distinctDocumentCount: number;
  patternFingerprint: string;
  patternFingerprintHash: string;
  votes: FieldLessonEvidenceSnapshotVote[];
  evaluatedAt: string;
  evaluatorVersion: string;
};

export type FieldLessonLastRevalidation = {
  at: string;
  evaluatorVersion: string;
  confirmedDistinctDocumentCount: number;
  droppedVoteCount: number;
};

export type FieldLessonLastMutation = {
  idempotencyKey: string;
  action: FieldLessonLifecycleAction;
  resultStatus: FieldLessonStatus;
  resultVersion: number;
  atIso: string;
};

export type VendorInvoiceFieldLessonDoc = {
  id: string;
  category: typeof FIELD_LESSON_CATEGORY;
  field: InvoiceCorrectableFieldKey;
  vendorKey: string;
  parserFormatId: "johnstone";
  senderDomain: string;
  scopeKey: string;
  status: FieldLessonStatus;
  version: number;
  patternFingerprint: string;
  patternFingerprintHash: string;
  extractionPattern: FieldLessonExtractionPattern;
  evidenceSnapshot: FieldLessonEvidenceSnapshot;
  distinctDocumentCount: number;
  proposedAt: string;
  proposedBy: string;
  suspendedAt: string | null;
  suspendedBy: string | null;
  disabledReason: FieldLessonDisabledReason | null;
  activatedAt: string | null;
  activatedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionNote: string | null;
  reactivatedAt: string | null;
  reactivatedBy: string | null;
  lastRevalidation: FieldLessonLastRevalidation | null;
  lastMutation: FieldLessonLastMutation | null;
  fpUndoCount: number;
  circuitBreakerTrips: string[];
  source: "c3d1_evaluate";
};

export const FIELD_LESSON_EVALUATOR_VERSION = "c3d1-v1";

export function hashPatternFingerprint(patternFingerprint: string): string {
  return createHash("sha256")
    .update(patternFingerprint, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function hashTextWindow(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function buildLessonDocId(input: {
  vendorKey: string;
  parserFormatId: string;
  senderDomain: string;
  field: string;
  patternFingerprint: string;
}): string {
  const scopeKey = buildScopeKey({
    vendorKey: input.vendorKey,
    parserFormatId: input.parserFormatId,
    senderDomain: input.senderDomain,
    field: input.field,
  });
  const hash = hashPatternFingerprint(input.patternFingerprint);
  return `${scopeKey}__${hash}`;
}

export { buildScopeKey };
