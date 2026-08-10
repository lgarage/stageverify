"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFieldLessonRevalidation = runFieldLessonRevalidation;
exports.applyFieldLessonStatusTransition = applyFieldLessonStatusTransition;
const firestore_1 = require("firebase-admin/firestore");
const patternFingerprint_1 = require("./patternFingerprint");
const evaluateFieldLessonCandidate_1 = require("./evaluateFieldLessonCandidate");
const vendorInvoiceFieldLessons_1 = require("./vendorInvoiceFieldLessons");
const indexFieldLessonExample_1 = require("./indexFieldLessonExample");
const fieldLessonAudit_1 = require("./fieldLessonAudit");
const labelAnchorAllowlist_1 = require("./labelAnchorAllowlist");
const MAX_REVALIDATION_VOTES = 40;
const MAX_SCOPE_EXAMPLES = 200;
function archiveAfterAtMillis(raw) {
    if (!raw)
        return null;
    if (raw instanceof firestore_1.Timestamp)
        return raw.toMillis();
    if (typeof raw === "object" && raw !== null) {
        const o = raw;
        if (typeof o.toMillis === "function")
            return o.toMillis();
        if (typeof o.seconds === "number")
            return o.seconds * 1000;
        if (typeof o._seconds === "number")
            return o._seconds * 1000;
    }
    return null;
}
function isTimeEligible(example, nowMs) {
    const ms = archiveAfterAtMillis(example.archiveAfterAt);
    if (ms == null)
        return false;
    return ms > nowMs;
}
async function loadCombinedExtractedText(db, vendorInvoiceImportId) {
    const impSnap = await db
        .collection("vendorInvoiceImports")
        .doc(vendorInvoiceImportId)
        .get();
    if (!impSnap.exists)
        return { text: "", inboundId: null };
    const inboundId = typeof impSnap.data()?.inboundEmailProcessingId === "string"
        ? impSnap.data().inboundEmailProcessingId.trim()
        : "";
    if (!inboundId)
        return { text: "", inboundId: null };
    const inSnap = await db.collection("inboundEmailProcessing").doc(inboundId).get();
    if (!inSnap.exists)
        return { text: "", inboundId };
    const text = typeof inSnap.data()?.combinedExtractedText === "string"
        ? inSnap.data().combinedExtractedText
        : "";
    return { text, inboundId };
}
function pickLatestPerDocument(docs) {
    const byDoc = new Map();
    for (const d of docs) {
        const data = d.data();
        if (data.evidenceType !== "document_evidence")
            continue;
        if (data.parserFormatId !== labelAnchorAllowlist_1.C3D1_ALLOWED_PARSER_FORMAT_ID)
            continue;
        const key = data.sourceDocumentKey?.trim();
        if (!key)
            continue;
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
async function collectLiveScopeFingerprints(db, scopeKey, nowMs) {
    const snap = await db
        .collection(indexFieldLessonExample_1.FIELD_LESSON_EXAMPLE_COLLECTION)
        .where("scopeKey", "==", scopeKey)
        .orderBy("verifiedAt", "desc")
        .limit(MAX_SCOPE_EXAMPLES)
        .get();
    const latest = pickLatestPerDocument(snap.docs);
    const fingerprints = new Set();
    let processed = 0;
    for (const [, example] of latest) {
        if (processed >= MAX_REVALIDATION_VOTES)
            break;
        processed += 1;
        if (!isTimeEligible(example, nowMs))
            continue;
        const { text } = await loadCombinedExtractedText(db, example.vendorInvoiceImportId);
        if (!(0, evaluateFieldLessonCandidate_1.spanMatchesCorrectedValue)({
            combinedExtractedText: text,
            evidenceSpanStart: example.evidenceSpanStart,
            evidenceSpanEnd: example.evidenceSpanEnd,
            correctedValue: example.correctedValue,
        })) {
            continue;
        }
        const match = (0, patternFingerprint_1.deriveAnchorMatch)({
            parserFormatId: example.parserFormatId,
            field: example.field,
            combinedExtractedText: text,
            evidenceSpanStart: example.evidenceSpanStart,
            evidenceSpanEnd: example.evidenceSpanEnd,
        });
        if ("skipReason" in match)
            continue;
        fingerprints.add(match.patternFingerprint);
    }
    return fingerprints;
}
/**
 * Revalidation for activate + reactivate (identical logic).
 * Never mutates lesson doc — caller writes on pass only.
 */
async function runFieldLessonRevalidation(input) {
    const nowMs = input.nowMs ?? Date.now();
    const lesson = input.lesson;
    const scopeSnap = await input.db
        .collection(indexFieldLessonExample_1.FIELD_LESSON_EXAMPLE_COLLECTION)
        .where("scopeKey", "==", lesson.scopeKey)
        .orderBy("verifiedAt", "desc")
        .limit(MAX_SCOPE_EXAMPLES)
        .get();
    const latestByDocument = pickLatestPerDocument(scopeSnap.docs);
    const votes = (lesson.evidenceSnapshot?.votes ?? []).slice(0, MAX_REVALIDATION_VOTES);
    const retainedDocKeys = new Set();
    let droppedVoteCount = 0;
    for (const vote of votes) {
        const docKey = vote.sourceDocumentKey?.trim();
        if (!docKey) {
            droppedVoteCount += 1;
            continue;
        }
        const latest = latestByDocument.get(docKey);
        if (!latest || latest.exampleId !== vote.exampleId) {
            droppedVoteCount += 1;
            continue;
        }
        const example = latest;
        if (example.evidenceType !== "document_evidence") {
            droppedVoteCount += 1;
            continue;
        }
        if (!isTimeEligible(example, nowMs)) {
            droppedVoteCount += 1;
            continue;
        }
        const { text } = await loadCombinedExtractedText(input.db, example.vendorInvoiceImportId);
        if (!(0, evaluateFieldLessonCandidate_1.spanMatchesCorrectedValue)({
            combinedExtractedText: text,
            evidenceSpanStart: example.evidenceSpanStart,
            evidenceSpanEnd: example.evidenceSpanEnd,
            correctedValue: vote.correctedValue,
        })) {
            droppedVoteCount += 1;
            continue;
        }
        const match = (0, patternFingerprint_1.deriveAnchorMatch)({
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
    if (confirmedDistinctDocumentCount < vendorInvoiceFieldLessons_1.MIN_DISTINCT_DOCUMENT_VOTES) {
        return {
            pass: false,
            confirmedDistinctDocumentCount,
            droppedVoteCount,
            failureReason: "distinct_documents_below_threshold",
        };
    }
    const liveFingerprints = await collectLiveScopeFingerprints(input.db, lesson.scopeKey, nowMs);
    const competing = [...liveFingerprints].filter((fp) => fp !== lesson.patternFingerprint);
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
function isValidTransition(action, from) {
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
function targetStatus(action) {
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
async function applyFieldLessonStatusTransition(input) {
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
    const ref = input.db.collection(vendorInvoiceFieldLessons_1.FIELD_LESSON_COLLECTION).doc(lessonId);
    const snap = await ref.get();
    if (!snap.exists) {
        return { ok: false, code: "not_found", message: "Lesson not found." };
    }
    const cur = snap.data();
    if (cur.lastMutation?.idempotencyKey === idempotencyKey &&
        cur.lastMutation.action === request.action) {
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
    let revalidation;
    if (request.action === "activate" || request.action === "reactivate") {
        revalidation = await runFieldLessonRevalidation({
            db: input.db,
            lesson: { ...cur, id: lessonId },
            nowMs,
        });
        if (!revalidation.pass) {
            const failEvent = request.action === "activate"
                ? "activation_revalidation_failed"
                : "reactivation_revalidation_failed";
            await (0, fieldLessonAudit_1.writeFieldLessonAuditEvent)(input.db, {
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
    const lastRevalidation = request.action === "activate" || request.action === "reactivate"
        ? {
            at: nowIso,
            evaluatorVersion: vendorInvoiceFieldLessons_1.FIELD_LESSON_EVALUATOR_VERSION,
            confirmedDistinctDocumentCount: revalidation.confirmedDistinctDocumentCount,
            droppedVoteCount: revalidation.droppedVoteCount,
        }
        : cur.lastRevalidation ?? null;
    const lastMutation = {
        idempotencyKey,
        action: request.action,
        resultStatus: nextStatus,
        resultVersion: nextVersion,
        atIso: nowIso,
    };
    const patch = {
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
    const successAuditEvent = request.action === "activate"
        ? "activated"
        : request.action === "reject"
            ? "rejected"
            : request.action === "suspend"
                ? "manual_suspended"
                : "reactivated";
    const auditRef = input.db.collection(fieldLessonAudit_1.FIELD_LESSON_AUDIT_COLLECTION).doc();
    const auditInput = {
        lessonId,
        eventType: successAuditEvent,
        actorUid: request.actorUid,
        priorStatus: cur.status,
        newStatus: nextStatus,
        scopeKey: cur.scopeKey,
        patternFingerprint: cur.patternFingerprint,
        distinctDocumentCount: revalidation?.confirmedDistinctDocumentCount,
        detail: request.action === "reject" && request.note?.trim()
            ? request.note.trim().slice(0, 500)
            : undefined,
    };
    let txOutcome;
    try {
        txOutcome = await input.db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists) {
                return { kind: "lesson_deleted" };
            }
            const freshData = fresh.data();
            if (freshData.lastMutation?.idempotencyKey === idempotencyKey &&
                freshData.lastMutation.action === request.action) {
                return { kind: "alreadyApplied" };
            }
            if ((freshData.version ?? 1) !== request.expectedVersion) {
                return { kind: "lesson_version_mismatch" };
            }
            tx.update(ref, patch);
            (0, fieldLessonAudit_1.writeFieldLessonAuditEventInTransaction)(tx, auditRef, auditInput, nowIso);
            return { kind: "applied" };
        });
    }
    catch (err) {
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
        const freshData = freshSnap.data();
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
            revalidationPassed: request.action === "activate" || request.action === "reactivate"
                ? true
                : undefined,
        },
    };
}
//# sourceMappingURL=fieldLessonLifecycle.js.map