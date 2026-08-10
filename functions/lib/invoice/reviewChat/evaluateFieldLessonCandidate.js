"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateFieldLessonScope = evaluateFieldLessonScope;
exports.listRecentExampleScopeKeys = listRecentExampleScopeKeys;
exports.parseScopeKey = parseScopeKey;
const firestore_1 = require("firebase-admin/firestore");
const indexFieldLessonExample_1 = require("./indexFieldLessonExample");
const patternFingerprint_1 = require("./patternFingerprint");
const vendorInvoiceFieldLessons_1 = require("./vendorInvoiceFieldLessons");
const fieldLessonAudit_1 = require("./fieldLessonAudit");
const correctionAllowlist_1 = require("./correctionAllowlist");
const labelAnchorAllowlist_1 = require("./labelAnchorAllowlist");
const MAX_DISTINCT_DOCS_PER_EVAL = 40;
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
        // Use stored example parserFormatId only (never re-route)
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
async function evaluateFieldLessonScope(input) {
    const nowMs = input.nowMs ?? Date.now();
    const vendorKey = input.scope.vendorKey.trim().toLowerCase();
    const parserFormatId = input.scope.parserFormatId.trim();
    const senderDomain = input.scope.senderDomain.trim().toLowerCase();
    const field = input.scope.field.trim();
    const scopeKey = (0, indexFieldLessonExample_1.buildScopeKey)({
        vendorKey,
        parserFormatId,
        senderDomain,
        field,
    });
    if (parserFormatId !== labelAnchorAllowlist_1.C3D1_ALLOWED_PARSER_FORMAT_ID) {
        return {
            scopeKey,
            outcome: "skipped_format",
            lessonId: null,
            distinctDocumentCount: 0,
            patternFingerprint: null,
            competingFingerprints: [],
            skippedVotes: 0,
        };
    }
    if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(field)) {
        return {
            scopeKey,
            outcome: "noop",
            lessonId: null,
            distinctDocumentCount: 0,
            patternFingerprint: null,
            competingFingerprints: [],
            skippedVotes: 0,
        };
    }
    const snap = await input.db
        .collection(indexFieldLessonExample_1.FIELD_LESSON_EXAMPLE_COLLECTION)
        .where("scopeKey", "==", scopeKey)
        .orderBy("verifiedAt", "desc")
        .limit(200)
        .get();
    const latest = pickLatestPerDocument(snap.docs);
    const clusters = new Map();
    let skippedVotes = 0;
    let processed = 0;
    for (const [, example] of latest) {
        if (processed >= MAX_DISTINCT_DOCS_PER_EVAL)
            break;
        processed += 1;
        if (!isTimeEligible(example, nowMs)) {
            skippedVotes += 1;
            continue;
        }
        const { text, inboundId } = await loadCombinedExtractedText(input.db, example.vendorInvoiceImportId);
        const match = (0, patternFingerprint_1.deriveAnchorMatch)({
            parserFormatId: example.parserFormatId,
            field: example.field,
            combinedExtractedText: text,
            evidenceSpanStart: example.evidenceSpanStart,
            evidenceSpanEnd: example.evidenceSpanEnd,
        });
        if ("skipReason" in match) {
            skippedVotes += 1;
            continue;
        }
        const windowStart = Math.max(0, (example.evidenceSpanStart ?? 0) - 80);
        const windowEnd = Math.min(text.length, (example.evidenceSpanEnd ?? 0) + 80);
        const vote = {
            sourceDocumentKey: example.sourceDocumentKey,
            exampleId: example.exampleId,
            correctedValue: example.correctedValue,
            verifiedAt: example.verifiedAt,
            textWindowHash: (0, vendorInvoiceFieldLessons_1.hashTextWindow)(text.slice(windowStart, windowEnd)),
            inboundEmailProcessingId: inboundId,
            captureShapeId: match.captureShapeId,
            matchedLiteral: match.matchedLiteral,
        };
        const existing = clusters.get(match.patternFingerprint);
        if (existing) {
            existing.votes.push(vote);
            if (!existing.matchedLiterals.includes(match.matchedLiteral)) {
                existing.matchedLiterals.push(match.matchedLiteral);
            }
        }
        else {
            clusters.set(match.patternFingerprint, {
                patternFingerprint: match.patternFingerprint,
                votes: [vote],
                captureShapeId: match.captureShapeId,
                matchedLiterals: [match.matchedLiteral],
                anchorKey: match.anchorKey,
            });
        }
    }
    const competing = [...clusters.entries()]
        .filter(([, c]) => c.votes.length >= 1)
        .map(([fp]) => fp);
    const contradiction = competing.length >= 2;
    if (contradiction) {
        const suspendResult = await autoSuspendLessonsInScope({
            db: input.db,
            scopeKey,
            actorUid: input.actorUid,
            reason: "contradictory_evidence",
            detail: `competing fingerprints: ${competing.join(",")}`,
        });
        await (0, fieldLessonAudit_1.writeFieldLessonAuditEvent)(input.db, {
            lessonId: suspendResult.lessonId ?? `scope:${scopeKey}`,
            eventType: suspendResult.suspended
                ? "contradiction_auto_suspended"
                : "contradiction_blocked",
            actorUid: input.actorUid,
            priorStatus: suspendResult.priorStatus,
            newStatus: suspendResult.suspended ? "suspended" : null,
            scopeKey,
            detail: `competing fingerprints: ${competing.join(",")}`,
            distinctDocumentCount: 0,
        });
        return {
            scopeKey,
            outcome: suspendResult.suspended
                ? "contradiction_auto_suspended"
                : "contradiction_blocked",
            lessonId: suspendResult.lessonId,
            distinctDocumentCount: 0,
            patternFingerprint: null,
            competingFingerprints: competing,
            skippedVotes,
        };
    }
    const winner = [...clusters.values()].sort((a, b) => b.votes.length - a.votes.length)[0];
    if (!winner || winner.votes.length < vendorInvoiceFieldLessons_1.MIN_DISTINCT_DOCUMENT_VOTES) {
        // Below threshold — suspend any proposed lesson that lost eligibility
        const suspendResult = await autoSuspendLessonsInScope({
            db: input.db,
            scopeKey,
            actorUid: input.actorUid,
            reason: "eligible_votes_below_threshold",
            detail: `votes=${winner?.votes.length ?? 0}`,
            onlyIfProposed: true,
        });
        if (suspendResult.suspended) {
            await (0, fieldLessonAudit_1.writeFieldLessonAuditEvent)(input.db, {
                lessonId: suspendResult.lessonId,
                eventType: "threshold_auto_suspended",
                actorUid: input.actorUid,
                priorStatus: "proposed",
                newStatus: "suspended",
                scopeKey,
                distinctDocumentCount: winner?.votes.length ?? 0,
            });
            return {
                scopeKey,
                outcome: "threshold_auto_suspended",
                lessonId: suspendResult.lessonId,
                distinctDocumentCount: winner?.votes.length ?? 0,
                patternFingerprint: winner?.patternFingerprint ?? null,
                competingFingerprints: [],
                skippedVotes,
            };
        }
        return {
            scopeKey,
            outcome: "below_threshold",
            lessonId: null,
            distinctDocumentCount: winner?.votes.length ?? 0,
            patternFingerprint: winner?.patternFingerprint ?? null,
            competingFingerprints: [],
            skippedVotes,
        };
    }
    const patternFingerprintHash = (0, vendorInvoiceFieldLessons_1.hashPatternFingerprint)(winner.patternFingerprint);
    const lessonId = (0, vendorInvoiceFieldLessons_1.buildLessonDocId)({
        vendorKey,
        parserFormatId,
        senderDomain,
        field,
        patternFingerprint: winner.patternFingerprint,
    });
    const evaluatedAt = new Date(nowMs).toISOString();
    const evidenceSnapshot = {
        distinctSourceDocumentKeys: winner.votes.map((v) => v.sourceDocumentKey),
        exampleIds: winner.votes.map((v) => v.exampleId),
        distinctDocumentCount: winner.votes.length,
        patternFingerprint: winner.patternFingerprint,
        patternFingerprintHash,
        votes: winner.votes,
        evaluatedAt,
        evaluatorVersion: vendorInvoiceFieldLessons_1.FIELD_LESSON_EVALUATOR_VERSION,
    };
    const lessonRef = input.db.collection(vendorInvoiceFieldLessons_1.FIELD_LESSON_COLLECTION).doc(lessonId);
    const writeOutcome = await input.db.runTransaction(async (tx) => {
        const existing = await tx.get(lessonRef);
        if (!existing.exists) {
            const doc = {
                id: lessonId,
                category: vendorInvoiceFieldLessons_1.FIELD_LESSON_CATEGORY,
                field,
                vendorKey,
                parserFormatId: "johnstone",
                senderDomain,
                scopeKey,
                status: "proposed",
                version: 1,
                patternFingerprint: winner.patternFingerprint,
                patternFingerprintHash,
                extractionPattern: {
                    category: vendorInvoiceFieldLessons_1.FIELD_LESSON_CATEGORY,
                    field,
                    canonicalAnchorKeys: [winner.anchorKey],
                    matchedLiteralAnchors: winner.matchedLiterals,
                    captureShapeId: winner.captureShapeId,
                    captureShapeNote: "bounded_token_near_anchor",
                },
                evidenceSnapshot,
                distinctDocumentCount: winner.votes.length,
                proposedAt: evaluatedAt,
                proposedBy: input.actorUid,
                suspendedAt: null,
                suspendedBy: null,
                disabledReason: null,
                fpUndoCount: 0,
                circuitBreakerTrips: [],
                source: "c3d1_evaluate",
            };
            tx.set(lessonRef, doc);
            return "proposed";
        }
        const cur = existing.data();
        // Never rewrite extractionPattern after first propose; refresh snapshot/counts only
        if (cur.patternFingerprint !== winner.patternFingerprint) {
            // Different fingerprint ⇒ different lessonId by construction; treat as noop here
            return "noop";
        }
        if (cur.status === "suspended") {
            // D.1 does not auto-reactivate
            return "noop";
        }
        const nextVersion = (cur.version ?? 1) + 1;
        tx.update(lessonRef, {
            version: nextVersion,
            evidenceSnapshot,
            distinctDocumentCount: winner.votes.length,
        });
        return "proposal_refreshed";
    });
    if (writeOutcome === "proposed" || writeOutcome === "proposal_refreshed") {
        await (0, fieldLessonAudit_1.writeFieldLessonAuditEvent)(input.db, {
            lessonId,
            eventType: writeOutcome === "proposed" ? "proposed" : "proposal_refreshed",
            actorUid: input.actorUid,
            priorStatus: writeOutcome === "proposed" ? null : "proposed",
            newStatus: "proposed",
            scopeKey,
            patternFingerprint: winner.patternFingerprint,
            distinctDocumentCount: winner.votes.length,
        });
    }
    return {
        scopeKey,
        outcome: writeOutcome,
        lessonId,
        distinctDocumentCount: winner.votes.length,
        patternFingerprint: winner.patternFingerprint,
        competingFingerprints: [],
        skippedVotes,
    };
}
async function autoSuspendLessonsInScope(input) {
    const snap = await input.db
        .collection(vendorInvoiceFieldLessons_1.FIELD_LESSON_COLLECTION)
        .where("scopeKey", "==", input.scopeKey)
        .limit(20)
        .get();
    if (snap.empty) {
        return { suspended: false, lessonId: null, priorStatus: null };
    }
    let any = false;
    let lessonId = null;
    let priorStatus = null;
    const nowIso = new Date().toISOString();
    for (const d of snap.docs) {
        const data = d.data();
        if (data.status === "suspended")
            continue;
        if (input.onlyIfProposed && data.status !== "proposed")
            continue;
        // D.1: only proposed docs exist; never touch active
        if (data.status !== "proposed")
            continue;
        await d.ref.update({
            status: "suspended",
            version: (data.version ?? 1) + 1,
            suspendedAt: nowIso,
            suspendedBy: input.actorUid,
            disabledReason: input.reason,
        });
        any = true;
        lessonId = d.id;
        priorStatus = data.status;
    }
    return { suspended: any, lessonId, priorStatus };
}
/** List distinct scopeKeys from recent examples (bounded) for batch evaluate. */
async function listRecentExampleScopeKeys(db, limit = 50) {
    const snap = await db
        .collection(indexFieldLessonExample_1.FIELD_LESSON_EXAMPLE_COLLECTION)
        .orderBy("verifiedAt", "desc")
        .limit(Math.min(Math.max(limit, 1), 200))
        .get();
    const keys = new Set();
    for (const d of snap.docs) {
        const sk = d.data()?.scopeKey;
        if (typeof sk === "string" && sk.trim())
            keys.add(sk.trim());
    }
    return [...keys];
}
function parseScopeKey(scopeKey) {
    const parts = scopeKey.split("__");
    if (parts.length !== 4)
        return null;
    const [vendorKey, parserFormatId, senderDomain, field] = parts;
    if (!vendorKey || !parserFormatId || !senderDomain || !field)
        return null;
    return { vendorKey, parserFormatId, senderDomain, field };
}
//# sourceMappingURL=evaluateFieldLessonCandidate.js.map