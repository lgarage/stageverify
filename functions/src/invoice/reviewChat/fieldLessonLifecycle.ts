/**
 * Lane C C3-D.2 — shared revalidation + Manager lifecycle transitions.
 * No parse effect. Never mutates evidenceSnapshot or extractionPattern after propose.
 */
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { deriveAnchorMatch } from "./patternFingerprint";
import { spanMatchesCorrectedValue } from "./evaluateFieldLessonCandidate";
import {
  FIELD_LESSON_COLLECTION,
  FIELD_LESSON_EVALUATOR_VERSION,
  MIN_DISTINCT_DOCUMENT_VOTES,
  type FieldLessonLifecycleAction,
  type FieldLessonLastMutation,
  type FieldLessonLastRevalidation,
  type FieldLessonStatus,
  type VendorInvoiceFieldLessonDoc,
} from "./vendorInvoiceFieldLessons";
import {
  FIELD_LESSON_EXAMPLE_COLLECTION,
  type FieldLessonExampleDoc,
} from "./indexFieldLessonExample";
import { writeFieldLessonAuditEvent } from "./fieldLessonAudit";
import { C3D1_ALLOWED_PARSER_FORMAT_ID } from "./labelAnchorAllowlist";

const MAX_REVALIDATION_VOTES = 40;
const MAX_SCOPE_EXAMPLES = 200;

export type FieldLessonLifecycleRequest = {
  lessonId: string;
  action: FieldLessonLifecycleAction;
  expectedVersion: number;
  idempotencyKey: string;
  note?: string;
  actorUid: string;
  nowMs?: number;
};

export type FieldLessonLifecycleResult = {
  lessonId: string;
  action: FieldLessonLifecycleAction;
  status: FieldLessonStatus;
  version: number;
  alreadyApplied: boolean;
  revalidationPassed?: boolean;
};

export type RevalidationResult = {
  pass: boolean;
  confirmedDistinctDocumentCount: number;
  droppedVoteCount: number;
  failureReason?: string;
};

function archiveAfterAtMillis(raw: unknown): number | null {
  if (!raw) return null;
  if (raw instanceof Timestamp) return raw.toMillis();
  if (typeof raw === "object" && raw !== null) {
    const o = raw as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o.seconds === "number") return o.seconds * 1000;
    if (typeof o._seconds === "number") return o._seconds * 1000;
  }
  return null;
}

function isTimeEligible(example: FieldLessonExampleDoc, nowMs: number): boolean {
  const ms = archiveAfterAtMillis(example.archiveAfterAt);
  if (ms == null) return false;
  return ms > nowMs;
}

async function loadCombinedExtractedText(
  db: Firestore,
  vendorInvoiceImportId: string,
): Promise<{ text: string; inboundId: string | null }> {
  const impSnap = await db
    .collection("vendorInvoiceImports")
    .doc(vendorInvoiceImportId)
    .get();
  if (!impSnap.exists) return { text: "", inboundId: null };
  const inboundId =
    typeof impSnap.data()?.inboundEmailProcessingId === "string"
      ? (impSnap.data()!.inboundEmailProcessingId as string).trim()
      : "";
  if (!inboundId) return { text: "", inboundId: null };
  const inSnap = await db.collection("inboundEmailProcessing").doc(inboundId).get();
  if (!inSnap.exists) return { text: "", inboundId };
  const text =
    typeof inSnap.data()?.combinedExtractedText === "string"
      ? (inSnap.data()!.combinedExtractedText as string)
      : "";
  return { text, inboundId };
}

function pickLatestPerDocument(
  docs: QueryDocumentSnapshot[],
): Map<string, FieldLessonExampleDoc & { exampleId: string }> {
  const byDoc = new Map<string, FieldLessonExampleDoc & { exampleId: string }>();
  for (const d of docs) {
    const data = d.data() as FieldLessonExampleDoc;
    if (data.evidenceType !== "document_evidence") continue;
    if (data.parserFormatId !== C3D1_ALLOWED_PARSER_FORMAT_ID) continue;
    const key = data.sourceDocumentKey?.trim();
    if (!key) continue;
    const prev = byDoc.get(key);
    if (!prev) {
      byDoc.set(key, { ...data, exampleId: d.id });
      continue;
    }
    const prevT = Date.parse(prev.verifiedAt || "") || 0;
    const nextT = Date.parse(data.verifiedAt || "") || 0;
    if (nextT >= prevT) {
      byDoc.set(key, { ...data, exampleId: d.id });
    }
  }
  return byDoc;
}

/** Live scope vote clusters for contradiction detection (read-only). */
async function collectLiveScopeFingerprints(
  db: Firestore,
  scopeKey: string,
  nowMs: number,
): Promise<Set<string>> {
  const snap = await db
    .collection(FIELD_LESSON_EXAMPLE_COLLECTION)
    .where("scopeKey", "==", scopeKey)
    .orderBy("verifiedAt", "desc")
    .limit(MAX_SCOPE_EXAMPLES)
    .get();

  const latest = pickLatestPerDocument(snap.docs);
  const fingerprints = new Set<string>();
  let processed = 0;

  for (const [, example] of latest) {
    if (processed >= MAX_REVALIDATION_VOTES) break;
    processed += 1;
    if (!isTimeEligible(example, nowMs)) continue;

    const { text } = await loadCombinedExtractedText(
      db,
      example.vendorInvoiceImportId,
    );
    if (
      !spanMatchesCorrectedValue({
        combinedExtractedText: text,
        evidenceSpanStart: example.evidenceSpanStart,
        evidenceSpanEnd: example.evidenceSpanEnd,
        correctedValue: example.correctedValue,
      })
    ) {
      continue;
    }
    const match = deriveAnchorMatch({
      parserFormatId: example.parserFormatId,
      field: example.field,
      combinedExtractedText: text,
      evidenceSpanStart: example.evidenceSpanStart,
      evidenceSpanEnd: example.evidenceSpanEnd,
    });
    if ("skipReason" in match) continue;
    fingerprints.add(match.patternFingerprint);
  }
  return fingerprints;
}

/**
 * Revalidation for activate + reactivate (identical logic).
 * Never mutates lesson doc — caller writes on pass only.
 */
export async function runFieldLessonRevalidation(input: {
  db: Firestore;
  lesson: VendorInvoiceFieldLessonDoc;
  nowMs?: number;
}): Promise<RevalidationResult> {
  const nowMs = input.nowMs ?? Date.now();
  const lesson = input.lesson;
  const votes = (lesson.evidenceSnapshot?.votes ?? []).slice(
    0,
    MAX_REVALIDATION_VOTES,
  );
  const retainedDocKeys = new Set<string>();
  let droppedVoteCount = 0;

  for (const vote of votes) {
    const exSnap = await input.db
      .collection(FIELD_LESSON_EXAMPLE_COLLECTION)
      .doc(vote.exampleId)
      .get();
    if (!exSnap.exists) {
      droppedVoteCount += 1;
      continue;
    }
    const example = exSnap.data() as FieldLessonExampleDoc;
    if (example.evidenceType !== "document_evidence") {
      droppedVoteCount += 1;
      continue;
    }
    if (!isTimeEligible(example, nowMs)) {
      droppedVoteCount += 1;
      continue;
    }
    const { text } = await loadCombinedExtractedText(
      input.db,
      example.vendorInvoiceImportId,
    );
    if (
      !spanMatchesCorrectedValue({
        combinedExtractedText: text,
        evidenceSpanStart: example.evidenceSpanStart,
        evidenceSpanEnd: example.evidenceSpanEnd,
        correctedValue: vote.correctedValue,
      })
    ) {
      droppedVoteCount += 1;
      continue;
    }
    const match = deriveAnchorMatch({
      parserFormatId: example.parserFormatId,
      field: example.field,
      combinedExtractedText: text,
      evidenceSpanStart: example.evidenceSpanStart,
      evidenceSpanEnd: example.evidenceSpanEnd,
    });
    if ("skipReason" in match) {
      droppedVoteCount += 1;
      continue;
    }
    if (match.patternFingerprint !== lesson.patternFingerprint) {
      droppedVoteCount += 1;
      continue;
    }
    retainedDocKeys.add(vote.sourceDocumentKey);
  }

  const confirmedDistinctDocumentCount = retainedDocKeys.size;
  if (confirmedDistinctDocumentCount < MIN_DISTINCT_DOCUMENT_VOTES) {
    return {
      pass: false,
      confirmedDistinctDocumentCount,
      droppedVoteCount,
      failureReason: "distinct_documents_below_threshold",
    };
  }

  const liveFingerprints = await collectLiveScopeFingerprints(
    input.db,
    lesson.scopeKey,
    nowMs,
  );
  const competing = [...liveFingerprints].filter(
    (fp) => fp !== lesson.patternFingerprint,
  );
  if (competing.length >= 1) {
    return {
      pass: false,
      confirmedDistinctDocumentCount,
      droppedVoteCount,
      failureReason: `live_contradiction:${competing.join(",")}`,
    };
  }

  return {
    pass: true,
    confirmedDistinctDocumentCount,
    droppedVoteCount,
  };
}

function isValidTransition(
  action: FieldLessonLifecycleAction,
  from: FieldLessonStatus,
): boolean {
  switch (action) {
    case "activate":
      return from === "proposed";
    case "reject":
      return from === "proposed";
    case "suspend":
      return from === "active";
    case "reactivate":
      return from === "suspended";
    default:
      return false;
  }
}

function targetStatus(action: FieldLessonLifecycleAction): FieldLessonStatus {
  switch (action) {
    case "activate":
    case "reactivate":
      return "active";
    case "reject":
      return "rejected";
    case "suspend":
      return "suspended";
    default:
      return "proposed";
  }
}

export async function applyFieldLessonStatusTransition(input: {
  db: Firestore;
  request: FieldLessonLifecycleRequest;
}): Promise<
  | { ok: true; result: FieldLessonLifecycleResult }
  | {
      ok: false;
      code:
        | "not_found"
        | "invalid_transition"
        | "lesson_version_mismatch"
        | "revalidation_failed";
      message: string;
      revalidation?: RevalidationResult;
    }
> {
  const { request } = input;
  const lessonId = request.lessonId.trim();
  if (!lessonId) {
    return { ok: false, code: "not_found", message: "lessonId required." };
  }
  const idempotencyKey = request.idempotencyKey.trim();
  if (!idempotencyKey) {
    return {
      ok: false,
      code: "invalid_transition",
      message: "idempotencyKey required.",
    };
  }

  const ref = input.db.collection(FIELD_LESSON_COLLECTION).doc(lessonId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, code: "not_found", message: "Lesson not found." };
  }
  const cur = snap.data() as VendorInvoiceFieldLessonDoc;

  if (
    cur.lastMutation?.idempotencyKey === idempotencyKey &&
    cur.lastMutation.action === request.action
  ) {
    return {
      ok: true,
      result: {
        lessonId,
        action: request.action,
        status: cur.status,
        version: cur.version ?? 1,
        alreadyApplied: true,
      },
    };
  }

  if ((cur.version ?? 1) !== request.expectedVersion) {
    return {
      ok: false,
      code: "lesson_version_mismatch",
      message: "Lesson version mismatch.",
    };
  }

  if (!isValidTransition(request.action, cur.status)) {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Cannot ${request.action} from status ${cur.status}.`,
    };
  }

  const nowMs = request.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let revalidation: RevalidationResult | undefined;

  if (request.action === "activate" || request.action === "reactivate") {
    revalidation = await runFieldLessonRevalidation({
      db: input.db,
      lesson: { ...cur, id: lessonId },
      nowMs,
    });
    if (!revalidation.pass) {
      const failEvent =
        request.action === "activate"
          ? "activation_revalidation_failed"
          : "reactivation_revalidation_failed";
      await writeFieldLessonAuditEvent(input.db, {
        lessonId,
        eventType: failEvent,
        actorUid: request.actorUid,
        priorStatus: cur.status,
        newStatus: null,
        scopeKey: cur.scopeKey,
        patternFingerprint: cur.patternFingerprint,
        distinctDocumentCount: revalidation.confirmedDistinctDocumentCount,
        detail: revalidation.failureReason ?? "revalidation_failed",
      });
      return {
        ok: false,
        code: "revalidation_failed",
        message: revalidation.failureReason ?? "Revalidation failed.",
        revalidation,
      };
    }
  }

  const nextStatus = targetStatus(request.action);
  const nextVersion = (cur.version ?? 1) + 1;
  const lastRevalidation: FieldLessonLastRevalidation | null =
    request.action === "activate" || request.action === "reactivate"
      ? {
          at: nowIso,
          evaluatorVersion: FIELD_LESSON_EVALUATOR_VERSION,
          confirmedDistinctDocumentCount:
            revalidation!.confirmedDistinctDocumentCount,
          droppedVoteCount: revalidation!.droppedVoteCount,
        }
      : cur.lastRevalidation ?? null;

  const lastMutation: FieldLessonLastMutation = {
    idempotencyKey,
    action: request.action,
    resultStatus: nextStatus,
    resultVersion: nextVersion,
    atIso: nowIso,
  };

  const patch: Record<string, unknown> = {
    status: nextStatus,
    version: nextVersion,
    lastMutation,
    lastRevalidation,
  };

  switch (request.action) {
    case "activate":
      patch.activatedAt = nowIso;
      patch.activatedBy = request.actorUid;
      patch.suspendedAt = null;
      patch.suspendedBy = null;
      patch.disabledReason = null;
      break;
    case "reactivate":
      patch.reactivatedAt = nowIso;
      patch.reactivatedBy = request.actorUid;
      patch.status = "active";
      patch.suspendedAt = null;
      patch.suspendedBy = null;
      patch.disabledReason = null;
      break;
    case "reject": {
      const note = (request.note ?? "").trim().slice(0, 500);
      patch.rejectedAt = nowIso;
      patch.rejectedBy = request.actorUid;
      patch.rejectionNote = note || null;
      break;
    }
    case "suspend":
      patch.suspendedAt = nowIso;
      patch.suspendedBy = request.actorUid;
      patch.disabledReason = "manual_suspend";
      break;
    default:
      break;
  }

  type TxOutcome =
    | { kind: "applied" }
    | { kind: "alreadyApplied" }
    | { kind: "lesson_deleted" }
    | { kind: "lesson_version_mismatch" };

  let txOutcome: TxOutcome;
  try {
    txOutcome = await input.db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) {
        return { kind: "lesson_deleted" as const };
      }
      const freshData = fresh.data() as VendorInvoiceFieldLessonDoc;
      if (
        freshData.lastMutation?.idempotencyKey === idempotencyKey &&
        freshData.lastMutation.action === request.action
      ) {
        return { kind: "alreadyApplied" as const };
      }
      if ((freshData.version ?? 1) !== request.expectedVersion) {
        return { kind: "lesson_version_mismatch" as const };
      }
      tx.update(ref, patch);
      return { kind: "applied" as const };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "lesson_deleted") {
      return { ok: false, code: "not_found", message: "Lesson not found." };
    }
    if (msg === "lesson_version_mismatch") {
      return {
        ok: false,
        code: "lesson_version_mismatch",
        message: "Lesson version mismatch.",
      };
    }
    throw err;
  }

  if (txOutcome.kind === "lesson_deleted") {
    return { ok: false, code: "not_found", message: "Lesson not found." };
  }
  if (txOutcome.kind === "lesson_version_mismatch") {
    return {
      ok: false,
      code: "lesson_version_mismatch",
      message: "Lesson version mismatch.",
    };
  }
  if (txOutcome.kind === "alreadyApplied") {
    const freshSnap = await ref.get();
    if (!freshSnap.exists) {
      return { ok: false, code: "not_found", message: "Lesson not found." };
    }
    const freshData = freshSnap.data() as VendorInvoiceFieldLessonDoc;
    return {
      ok: true,
      result: {
        lessonId,
        action: request.action,
        status: freshData.status,
        version: freshData.version ?? 1,
        alreadyApplied: true,
      },
    };
  }

  const auditEvent =
    request.action === "activate"
      ? "activated"
      : request.action === "reject"
        ? "rejected"
        : request.action === "suspend"
          ? "manual_suspended"
          : "reactivated";

  await writeFieldLessonAuditEvent(input.db, {
    lessonId,
    eventType: auditEvent,
    actorUid: request.actorUid,
    priorStatus: cur.status,
    newStatus: nextStatus,
    scopeKey: cur.scopeKey,
    patternFingerprint: cur.patternFingerprint,
    distinctDocumentCount: revalidation?.confirmedDistinctDocumentCount,
    detail:
      request.action === "reject" && request.note?.trim()
        ? request.note.trim().slice(0, 500)
        : undefined,
  });

  return {
    ok: true,
    result: {
      lessonId,
      action: request.action,
      status: nextStatus,
      version: nextVersion,
      alreadyApplied: false,
      revalidationPassed:
        request.action === "activate" || request.action === "reactivate"
          ? true
          : undefined,
    },
  };
}
