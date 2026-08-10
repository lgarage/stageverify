"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVendorInvoiceFieldLessons = void 0;
/**
 * Lane C C3-D — Manager/Admin list of field lessons (all lifecycle statuses).
 * NOT a generic C3-C.2 evidence browser.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const vendorInvoiceFieldLessons_1 = require("./invoice/reviewChat/vendorInvoiceFieldLessons");
function getDb() {
    return admin.firestore();
}
function sanitizeLesson(doc) {
    return {
        id: doc.id,
        category: doc.category,
        field: doc.field,
        vendorKey: doc.vendorKey,
        parserFormatId: doc.parserFormatId,
        senderDomain: doc.senderDomain,
        scopeKey: doc.scopeKey,
        status: doc.status,
        version: doc.version,
        patternFingerprint: doc.patternFingerprint,
        patternFingerprintHash: doc.patternFingerprintHash,
        extractionPattern: doc.extractionPattern,
        distinctDocumentCount: doc.distinctDocumentCount,
        proposedAt: doc.proposedAt,
        proposedBy: doc.proposedBy,
        suspendedAt: doc.suspendedAt ?? null,
        suspendedBy: doc.suspendedBy ?? null,
        disabledReason: doc.disabledReason ?? null,
        activatedAt: doc.activatedAt ?? null,
        activatedBy: doc.activatedBy ?? null,
        rejectedAt: doc.rejectedAt ?? null,
        rejectedBy: doc.rejectedBy ?? null,
        rejectionNote: doc.rejectionNote ?? null,
        reactivatedAt: doc.reactivatedAt ?? null,
        reactivatedBy: doc.reactivatedBy ?? null,
        lastRevalidation: doc.lastRevalidation ?? null,
        lastMutation: doc.lastMutation
            ? {
                idempotencyKey: doc.lastMutation.idempotencyKey,
                action: doc.lastMutation.action,
                resultStatus: doc.lastMutation.resultStatus,
                resultVersion: doc.lastMutation.resultVersion,
                atIso: doc.lastMutation.atIso,
            }
            : null,
        evidenceSnapshot: {
            distinctDocumentCount: doc.evidenceSnapshot?.distinctDocumentCount ?? 0,
            distinctSourceDocumentKeys: doc.evidenceSnapshot?.distinctSourceDocumentKeys ?? [],
            exampleIds: doc.evidenceSnapshot?.exampleIds ?? [],
            patternFingerprint: doc.evidenceSnapshot?.patternFingerprint ?? "",
            patternFingerprintHash: doc.evidenceSnapshot?.patternFingerprintHash ?? "",
            evaluatedAt: doc.evidenceSnapshot?.evaluatedAt ?? "",
            evaluatorVersion: doc.evidenceSnapshot?.evaluatorVersion ?? "",
            votes: (doc.evidenceSnapshot?.votes ?? []).map((v) => ({
                sourceDocumentKey: v.sourceDocumentKey,
                exampleId: v.exampleId,
                correctedValue: v.correctedValue,
                verifiedAt: v.verifiedAt,
                captureShapeId: v.captureShapeId,
                matchedLiteral: v.matchedLiteral,
                textWindowHash: v.textWindowHash,
            })),
        },
    };
}
exports.listVendorInvoiceFieldLessons = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const limit = (0, dispatcherAuth_1.clampListLimit)(data.limit, 50, 100);
    const status = data.status === "proposed" ||
        data.status === "suspended" ||
        data.status === "active" ||
        data.status === "rejected"
        ? data.status
        : null;
    const scopeKey = typeof data.scopeKey === "string" && data.scopeKey.trim()
        ? data.scopeKey.trim()
        : null;
    const col = getDb().collection(vendorInvoiceFieldLessons_1.FIELD_LESSON_COLLECTION);
    let query = col;
    if (scopeKey) {
        query = query.where("scopeKey", "==", scopeKey);
    }
    if (status) {
        query = query.where("status", "==", status);
    }
    let snap;
    try {
        snap = await query.orderBy("proposedAt", "desc").limit(limit).get();
    }
    catch {
        snap = await query.limit(limit).get();
    }
    const lessons = snap.docs.map((d) => {
        const data = d.data();
        return sanitizeLesson({ ...data, id: d.id });
    });
    return { lessons, count: lessons.length };
});
//# sourceMappingURL=listVendorInvoiceFieldLessonsApi.js.map