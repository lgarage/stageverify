/**
 * Lane C C3-D.2 — shared revalidation + Manager lifecycle transitions.
 * No parse effect. Never mutates evidenceSnapshot or extractionPattern after propose.
 */
import type { Firestore, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
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
import {
  FIELD_LESSON_AUDIT_COLLECTION,
  writeFieldLessonAuditEvent,
  writeFieldLessonAuditEventInTransaction,
  type FieldLessonAuditEventType,
} from "./fieldLessonAudit";
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

type LatestExample = FieldLessonExampleDoc & { exampleId: string };

/**
 * Shared vote retention + threshold + live-contradiction semantics for
 * runFieldLessonRevalidation and verifyRevalidationAtCommit.
 */
async function evaluateSnapshotVotesAgainstLatest(input: {
  db: Firestore;
  lesson: VendorInvoiceFieldLessonDoc;
  latestByDocument: Map<string, LatestExample>;
  nowMs: number;
  /** Commit-time: tx-bound example fetch + guard identity check. */
  resolveExample?: (
    docKey: string,
    latest: LatestExample,
  ) => Promise<FieldLessonExampleDoc | null>;
}): Promise<RevalidationResult> {
  const lesson = input.lesson;
  const votes = (lesson.evidenceSnapshot?.votes ?? []).slice(
    0,
    MAX_REVALIDATION_VOTES,
  );
  const retainedDocKeys = new Set<string>();
  let droppedVoteCount = 0;

  for (const vote of votes) {
    const docKey = vote.sourceDocumentKey?.trim();
    if (!docKey) {
      droppedVoteCount += 1;
      continue;
    }
    const latest = input.latestByDocument.get(docKey);
    if (!latest || latest.exampleId !== vote.exampleId) {
      droppedVoteCount += 1;
      continue;
    }
    const example = input.resolveExample
      ? await input.resolveExample(docKey, latest)
      : latest;
    if (!example) {
      droppedVoteCount += 1;
      continue;
    }
    if (example.evidenceType !== "document_evidence") {
      droppedVoteCount += 1;
      continue;
    }
    if (!isTimeEligible(example, input.nowMs)) {
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
    retainedDocKeys.add(docKey);
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
    input.nowMs,
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

  const scopeSnap = await input.db
    .collection(FIELD_LESSON_EXAMPLE_COLLECTION)
    .where("scopeKey", "==", lesson.scopeKey)
    .orderBy("verifiedAt", "desc")
    .limit(MAX_SCOPE_EXAMPLES)
    .get();
  const latestByDocument = pickLatestPerDocument(scopeSnap.docs);

  return evaluateSnapshotVotesAgainstLatest({
    db: input.db,
    lesson,
    latestByDocument,
    nowMs,
  });
}

/** Latest example identity per sourceDocumentKey — snapshot for commit-time tx verification. */
export type LatestExampleGuardEntry = {
  exampleId: string;
  verifiedAt: string;
};

export async function loadScopeLatestExampleGuard(
  db: Firestore,
  scopeKey: string,
): Promise<Record<string, LatestExampleGuardEntry>> {
  const snap = await db
    .collection(FIELD_LESSON_EXAMPLE_COLLECTION)
    .where("scopeKey", "==", scopeKey)
    .orderBy("verifiedAt", "desc")
    .limit(MAX_SCOPE_EXAMPLES)
    .get();
  const latestByDocument = pickLatestPerDocument(snap.docs);
  const guard: Record<string, LatestExampleGuardEntry> = {};
  for (const [docKey, example] of latestByDocument) {
    guard[docKey] = {
      exampleId: example.exampleId,
      verifiedAt: example.verifiedAt || "",
    };
  }
  return guard;
}

/**
 * Commit-time revalidation inside a Firestore transaction.
 * Re-reads latest-per-document via tx.get(query), tx-binds example identity,
 * then runs the same span/fingerprint/contradiction checks as pre-tx revalidation.
 */
export async function verifyRevalidationAtCommit(input: {
  tx: Transaction;
  db: Firestore;
  lesson: VendorInvoiceFieldLessonDoc;
  /** Pre-tx guard — used to detect example doc mutation between guard load and tx. */
  expectedLatestByDocKey: Record<string, LatestExampleGuardEntry>;
  nowMs: number;
}): Promise<RevalidationResult> {
  const scopeQuery = input.db
    .collection(FIELD_LESSON_EXAMPLE_COLLECTION)
    .where("scopeKey", "==", input.lesson.scopeKey)
    .orderBy("verifiedAt", "desc")
    .limit(MAX_SCOPE_EXAMPLES);
  const scopeSnap = await input.tx.get(scopeQuery);
  const latestByDocument = pickLatestPerDocument(scopeSnap.docs);
  const exampleCol = input.db.collection(FIELD_LESSON_EXAMPLE_COLLECTION);
  const guard = input.expectedLatestByDocKey;

  return evaluateSnapshotVotesAgainstLatest({
    db: input.db,
    lesson: input.lesson,
    latestByDocument,
    nowMs: input.nowMs,
    resolveExample: async (docKey, latest) => {
      const expected = guard[docKey];
      if (!expected || expected.exampleId !== latest.exampleId) {
        return null;
      }
      const exSnap = await input.tx.get(exampleCol.doc(latest.exampleId));
      if (!exSnap.exists) {
        return null;
      }
      const example = exSnap.data() as FieldLessonExampleDoc;
      if ((example.verifiedAt || "") !== expected.verifiedAt) {
        return null;
      }
      if (example.sourceDocumentKey?.trim() !== docKey) {
        return null;
      }
      return example;
    },
  });
}

async function writeRevalidationFailureAudit(
  db: Firestore,
  input: {
    lessonId: string;
    action: FieldLessonLifecycleAction;
    actorUid: string;
    lesson: VendorInvoiceFieldLessonDoc;
    revalidation: RevalidationResult;
  },
): Promise<void> {
  const failEvent =
    input.action === "activate"
      ? "activation_revalidation_failed"
      : "reactivation_revalidation_failed";
  await writeFieldLessonAuditEvent(db, {
    lessonId: input.lessonId,
    eventType: failEvent,
    actorUid: input.actorUid,
    priorStatus: input.lesson.status,
    newStatus: null,
    scopeKey: input.lesson.scopeKey,
    patternFingerprint: input.lesson.patternFingerprint,
    distinctDocumentCount: input.revalidation.confirmedDistinctDocumentCount,
    detail: input.revalidation.failureReason ?? "revalidation_failed",
  });
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
      await writeRevalidationFailureAudit(input.db, {
        lessonId,
        action: request.action,
        actorUid: request.actorUid,
        lesson: cur,
        revalidation,
      });
      return {
        ok: false,
        code: "revalidation_failed",
        message: revalidation.failureReason ?? "Revalidation failed.",
        revalidation,
      };
    }
  }

  let commitExampleGuard: Record<string, LatestExampleGuardEntry> | undefined;
  if (request.action === "activate" || request.action === "reactivate") {
    revalidation = await runFieldLessonRevalidation({
      db: input.db,
      lesson: { ...cur, id: lessonId },
      nowMs,
    });
    if (!revalidation.pass) {
      await writeRevalidationFailureAudit(input.db, {
        lessonId,
        action: request.action,
        actorUid: request.actorUid,
        lesson: cur,
        revalidation,
      });
      return {
        ok: false,
        code: "revalidation_failed",
        message: revalidation.failureReason ?? "Revalidation failed.",
        revalidation,
      };
    }
    commitExampleGuard = await loadScopeLatestExampleGuard(
      input.db,
      cur.scopeKey,
    );
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
    | { kind: "lesson_version_mismatch" }
    | { kind: "invalid_transition" }
    | { kind: "revalidation_failed"; revalidation: RevalidationResult };

  const successAuditEvent: FieldLessonAuditEventType =
    request.action === "activate"
      ? "activated"
      : request.action === "reject"
        ? "rejected"
        : request.action === "suspend"
          ? "manual_suspended"
          : "reactivated";

  const auditRef = input.db.collection(FIELD_LESSON_AUDIT_COLLECTION).doc();
  const auditInput = {
    lessonId,
    eventType: successAuditEvent,
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
  };

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
      if (!isValidTransition(request.action, freshData.status)) {
        return { kind: "invalid_transition" as const };
      }
      if (
        (request.action === "activate" || request.action === "reactivate") &&
        commitExampleGuard
      ) {
        const commitReval = await verifyRevalidationAtCommit({
          tx,
          db: input.db,
          lesson: freshData,
          expectedLatestByDocKey: commitExampleGuard,
          nowMs,
        });
        if (!commitReval.pass) {
          return {
            kind: "revalidation_failed" as const,
            revalidation: commitReval,
          };
        }
        revalidation = commitReval;
      }
      tx.update(ref, patch);
      writeFieldLessonAuditEventInTransaction(tx, auditRef, auditInput, nowIso);
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
  if (txOutcome.kind === "invalid_transition") {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Cannot ${request.action} from current status.`,
    };
  }
  if (txOutcome.kind === "revalidation_failed") {
    await writeRevalidationFailureAudit(input.db, {
      lessonId,
      action: request.action,
      actorUid: request.actorUid,
      lesson: cur,
      revalidation: txOutcome.revalidation,
    });
    return {
      ok: false,
      code: "revalidation_failed",
      message:
        txOutcome.revalidation.failureReason ?? "Revalidation failed at commit.",
      revalidation: txOutcome.revalidation,
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
