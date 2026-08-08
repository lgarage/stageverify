"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BULK_REOPEN_MAX_PROCESS = exports.CIRCUIT_BREAKER_REOPEN_THRESHOLD = void 0;
exports.qualifiesForCircuitBreakerReopen = qualifiesForCircuitBreakerReopen;
exports.reopenVendorInvoiceImportCore = reopenVendorInvoiceImportCore;
exports.bulkReopenImportsSkippedByRuleCore = bulkReopenImportsSkippedByRuleCore;
/**
 * D-59 P6 — circuit breaker on reopen of document-ignore-skipped imports.
 * Shared by approveVendorInvoiceImport reopen + bulkReopenImportsSkippedByRule.
 */
const firestore_1 = require("firebase-admin/firestore");
const computeAutoImportEligibility_1 = require("../computeAutoImportEligibility");
const vendorIgnoreRules_1 = require("./vendorIgnoreRules");
const ignoreRuleAudit_1 = require("./ignoreRuleAudit");
const adminConfig_1 = require("./adminConfig");
const notifyTrainingLessonPending_1 = require("./notifyTrainingLessonPending");
const creditReturnSkip_1 = require("../creditReturnSkip");
exports.CIRCUIT_BREAKER_REOPEN_THRESHOLD = 2;
/** Max imports processed per bulk reopen (single-field query + in-memory filter). */
exports.BULK_REOPEN_MAX_PROCESS = 200;
const MAX_DECISION_LOG = 20;
function qualifiesForCircuitBreakerReopen(doc) {
    return (doc.rejectedBy === "system:document_ignore_skip" &&
        typeof doc.matchedRuleId === "string" &&
        doc.matchedRuleId.trim().length > 0);
}
function eligibilityFromDoc(doc) {
    return (0, computeAutoImportEligibility_1.computeAutoImportEligibility)({
        importStatus: doc.importStatus,
        confidenceScore: doc.confidenceScore,
        humanReviewRequired: doc.humanReviewRequired,
        duplicate: doc.duplicate,
        parseWarnings: doc.parseWarnings,
        parsedHeader: doc.parsedHeader,
        parsedLines: doc.parsedLines,
        parsedLineCount: doc.parsedLineCount,
        pageId: doc.pageId,
    });
}
function appendDecisionLogUpdate(doc, entry) {
    const prior = doc.importDecisionLog ?? [];
    return [...prior, entry].slice(-MAX_DECISION_LOG);
}
async function applyCircuitBreakerOnRule(db, ruleId, importId, actorUid) {
    const ruleRef = db.collection(vendorIgnoreRules_1.VENDOR_IGNORE_RULES_COLLECTION).doc(ruleId);
    const txResult = await db.runTransaction(async (tx) => {
        const ruleSnap = await tx.get(ruleRef);
        if (!ruleSnap.exists) {
            return { reopenCount: 0, autoDisabled: false, vendorKey: ruleId };
        }
        const raw = (ruleSnap.data() ?? {});
        const priorCount = typeof raw.reopenCount === "number" && Number.isFinite(raw.reopenCount)
            ? raw.reopenCount
            : 0;
        const nextCount = priorCount + 1;
        const status = raw.status;
        const shouldDisable = nextCount >= exports.CIRCUIT_BREAKER_REOPEN_THRESHOLD && status === "active";
        const now = new Date().toISOString();
        const vendorKey = typeof raw.vendorKey === "string" && raw.vendorKey.trim()
            ? raw.vendorKey.trim()
            : ruleId;
        const patch = {
            reopenCount: nextCount,
            updatedAt: now,
        };
        if (shouldDisable) {
            patch.status = "disabled";
            patch.enabled = false;
            patch.disabledReason = "auto_false_positive";
            patch.disabledBy = "system";
            patch.disabledAt = now;
            patch.updatedBy = "system";
        }
        tx.set(ruleRef, patch, { merge: true });
        return { reopenCount: nextCount, autoDisabled: shouldDisable, vendorKey };
    });
    await (0, ignoreRuleAudit_1.writeIgnoreRuleAuditEvent)(db, {
        ruleId,
        eventType: "match_reopened",
        actorUid,
        importId,
    });
    if (txResult.autoDisabled) {
        await (0, ignoreRuleAudit_1.writeIgnoreRuleAuditEvent)(db, {
            ruleId,
            eventType: "auto_disabled_false_positive",
            actorUid: "system",
            importId,
            detail: `reopenCount reached ${txResult.reopenCount}`,
        });
        try {
            const alertEmail = await (0, adminConfig_1.readAlertEmailFromSecrets)();
            if (alertEmail) {
                await (0, notifyTrainingLessonPending_1.notifyTrainingLessonPendingAdmin)({
                    alertEmail,
                    vendorKey: txResult.vendorKey,
                    reason: `Ignore rule auto-disabled after ${txResult.reopenCount} re-opens (false-positive circuit breaker). Rule: ${ruleId}`,
                    importId,
                });
            }
        }
        catch (err) {
            console.error("circuit breaker admin alert failed:", err);
        }
    }
    return txResult;
}
/**
 * Reopen one rejected import. Increments rule reopenCount only when
 * rejectedBy === system:document_ignore_skip and matchedRuleId is set.
 */
async function reopenVendorInvoiceImportCore(db, input) {
    const importId = input.importId.trim();
    const now = input.now ?? new Date().toISOString();
    const importRef = db.collection("vendorInvoiceImports").doc(importId);
    const preSnap = await importRef.get();
    if (!preSnap.exists) {
        throw new Error("import_not_found");
    }
    const pre = preSnap.data();
    if (pre.reviewStatus === "pending_review") {
        return { reopened: false, skipped: true, reason: "already_pending" };
    }
    if (pre.reviewStatus !== "rejected") {
        throw new Error("not_rejected");
    }
    if (!(0, creditReturnSkip_1.isSystemAutoRejectedImport)(pre)) {
        throw new Error("manual_reject_not_reopenable");
    }
    const matchedRuleId = qualifiesForCircuitBreakerReopen(pre)
        ? pre.matchedRuleId.trim()
        : undefined;
    await db.runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
            throw new Error("import_not_found");
        }
        const fresh = freshImport.data();
        if (fresh.reviewStatus !== "rejected") {
            if (fresh.reviewStatus === "pending_review") {
                return;
            }
            throw new Error("not_rejected");
        }
        if (!(0, creditReturnSkip_1.isSystemAutoRejectedImport)(fresh)) {
            throw new Error("manual_reject_not_reopenable");
        }
        tx.update(importRef, {
            reviewStatus: "pending_review",
            rejectedAt: firestore_1.FieldValue.delete(),
            rejectedBy: firestore_1.FieldValue.delete(),
            skipReason: firestore_1.FieldValue.delete(),
            matchedRuleId: firestore_1.FieldValue.delete(),
            updatedAt: now,
            importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("reopen", input.actorUid, now, eligibilityFromDoc(fresh))),
        });
    });
    const afterSnap = await importRef.get();
    const after = afterSnap.data();
    if (after.reviewStatus !== "pending_review") {
        return { reopened: false, skipped: true, reason: "already_pending" };
    }
    if (!matchedRuleId) {
        return { reopened: true, skipped: false };
    }
    const circuit = await applyCircuitBreakerOnRule(db, matchedRuleId, importId, input.actorUid);
    return {
        reopened: true,
        skipped: false,
        matchedRuleId,
        reopenCount: circuit.reopenCount,
        autoDisabled: circuit.autoDisabled,
    };
}
function isBulkReopenCandidate(data) {
    return (data.reviewStatus === "rejected" &&
        data.rejectedBy === "system:document_ignore_skip");
}
/** Bulk reopen all rejected document-ignore skips for one rule (manager). */
async function bulkReopenImportsSkippedByRuleCore(db, input) {
    const ruleId = input.ruleId.trim();
    if (!ruleId) {
        throw new Error("rule_id_required");
    }
    const snap = await db
        .collection("vendorInvoiceImports")
        .where("matchedRuleId", "==", ruleId)
        .get();
    const candidates = snap.docs.filter((docSnap) => isBulkReopenCandidate(docSnap.data()));
    const matchedTotal = candidates.length;
    const toProcess = candidates.slice(0, exports.BULK_REOPEN_MAX_PROCESS);
    const truncated = matchedTotal > exports.BULK_REOPEN_MAX_PROCESS;
    let reopened = 0;
    let skipped = 0;
    let autoDisabled = false;
    let lastReopenCount;
    for (const docSnap of toProcess) {
        const result = await reopenVendorInvoiceImportCore(db, {
            importId: docSnap.id,
            actorUid: input.actorUid,
        });
        if (result.reopened) {
            reopened++;
            if (result.autoDisabled)
                autoDisabled = true;
            if (result.reopenCount != null)
                lastReopenCount = result.reopenCount;
        }
        else if (result.skipped) {
            skipped++;
        }
    }
    return {
        ruleId,
        scanned: toProcess.length,
        reopened,
        skipped,
        autoDisabled,
        reopenCount: lastReopenCount,
        ...(truncated ? { truncated: true, matchedTotal } : {}),
    };
}
//# sourceMappingURL=reopenIgnoreSkippedImport.js.map