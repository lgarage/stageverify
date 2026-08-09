"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_LESSON_EXAMPLE_CATEGORY = exports.FIELD_LESSON_EXAMPLE_RETENTION_DAYS = exports.FIELD_LESSON_EXAMPLE_COLLECTION = void 0;
exports.resolveArmableVendorKeyFromDetectedName = resolveArmableVendorKeyFromDetectedName;
exports.buildScopeKey = buildScopeKey;
exports.buildArchiveAfterAtTimestamp = buildArchiveAfterAtTimestamp;
exports.buildFieldLessonExampleFromApply = buildFieldLessonExampleFromApply;
exports.writeFieldLessonExampleIfEligible = writeFieldLessonExampleIfEligible;
const firestore_1 = require("firebase-admin/firestore");
const vendorTrainingMd_1 = require("../aiShadow/vendorTrainingMd");
const vendorIgnoreRules_1 = require("../aiShadow/vendorIgnoreRules");
const vendorIgnoreEcho_1 = require("../vendorIgnoreEcho");
const correctionAllowlist_1 = require("./correctionAllowlist");
exports.FIELD_LESSON_EXAMPLE_COLLECTION = "vendorInvoiceFieldLessonExamples";
exports.FIELD_LESSON_EXAMPLE_RETENTION_DAYS = 365;
exports.FIELD_LESSON_EXAMPLE_CATEGORY = "header_field_extraction";
const MAX_INDEX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 40;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isAlreadyExistsError(err) {
    if (!err || typeof err !== "object")
        return false;
    const e = err;
    if (e.code === 6 || e.code === "already-exists" || e.code === "ALREADY_EXISTS") {
        return true;
    }
    const msg = typeof e.message === "string" ? e.message : "";
    return /ALREADY_EXISTS|already.?exists/i.test(msg);
}
function normalizeParserFormatId(raw) {
    if (raw === "johnstone" || raw === "first_supply" || raw === "generic") {
        return raw;
    }
    return null;
}
/**
 * Resolve vendorKey for C3-C scoping — NEVER invent from parserFormatId
 * (vendorKeyFromImportDoc johnstone fallback is forbidden here).
 */
function resolveArmableVendorKeyFromDetectedName(detectedVendorName) {
    if (typeof detectedVendorName !== "string" || !detectedVendorName.trim()) {
        return null;
    }
    const key = (0, vendorTrainingMd_1.sanitizeVendorKey)(detectedVendorName);
    if (!(0, vendorIgnoreRules_1.isArmableVendorKey)(key))
        return null;
    return key;
}
function buildScopeKey(input) {
    return `${input.vendorKey}__${input.parserFormatId}__${input.senderDomain}__${input.field}`;
}
function buildArchiveAfterAtTimestamp(verifiedAtMs, retentionDays = exports.FIELD_LESSON_EXAMPLE_RETENTION_DAYS) {
    return firestore_1.Timestamp.fromMillis(verifiedAtMs + retentionDays * 86_400_000);
}
/** Pure builder — unit-testable; no I/O. */
function buildFieldLessonExampleFromApply(input) {
    const importId = input.vendorInvoiceImportId.trim();
    const correctionId = input.correctionId.trim();
    if (!importId)
        return { ok: false, reason: "missing_import_id" };
    if (!correctionId)
        return { ok: false, reason: "missing_correction_id" };
    if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(input.field)) {
        return { ok: false, reason: "field_not_allowed" };
    }
    const vendorKey = resolveArmableVendorKeyFromDetectedName(input.detectedVendorName);
    if (!vendorKey)
        return { ok: false, reason: "vendor_not_armable" };
    const parserFormatId = normalizeParserFormatId(input.parserFormatId);
    if (!parserFormatId)
        return { ok: false, reason: "format_unknown" };
    const senderDomain = input.senderDomain.trim().toLowerCase();
    if (!senderDomain)
        return { ok: false, reason: "sender_domain_unavailable" };
    const verifiedAt = input.verifiedAt ?? new Date().toISOString();
    const verifiedAtMs = Date.parse(verifiedAt);
    const archiveBaseMs = Number.isFinite(verifiedAtMs)
        ? verifiedAtMs
        : Date.now();
    const scopeKey = buildScopeKey({
        vendorKey,
        parserFormatId,
        senderDomain,
        field: input.field,
    });
    const doc = {
        id: correctionId,
        exampleId: correctionId,
        correctionId,
        vendorInvoiceImportId: importId,
        sourceDocumentKey: importId,
        sourceChatMessageId: input.sourceChatMessageId.trim(),
        category: exports.FIELD_LESSON_EXAMPLE_CATEGORY,
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
        verifiedAtServer: firestore_1.FieldValue.serverTimestamp(),
        status: "active",
        retentionDays: exports.FIELD_LESSON_EXAMPLE_RETENTION_DAYS,
        archiveAfterAt: buildArchiveAfterAtTimestamp(archiveBaseMs),
        archivedAt: null,
        scopeKey,
        source: "c2_verified_correction",
        idempotencyKey: correctionId,
    };
    return { ok: true, doc };
}
async function loadSenderDomain(db, inboundEmailProcessingId) {
    const inboundId = typeof inboundEmailProcessingId === "string"
        ? inboundEmailProcessingId.trim()
        : "";
    if (!inboundId)
        return null;
    const snap = await db.collection("inboundEmailProcessing").doc(inboundId).get();
    if (!snap.exists)
        return null;
    const senderEmail = typeof snap.data()?.senderEmail === "string"
        ? snap.data().senderEmail
        : "";
    const domains = (0, vendorIgnoreEcho_1.normalizeSenderDomains)([senderEmail]);
    if (domains.length === 0) {
        // Fallback: extractSenderDomain alone (normalize may reject junk)
        return (0, vendorIgnoreEcho_1.extractSenderDomain)(senderEmail);
    }
    return domains[0] ?? null;
}
/**
 * Best-effort index after successful C2 apply. Never throws to caller.
 * Uses .create() only (immutable). Bounded retries for transient errors.
 */
async function writeFieldLessonExampleIfEligible(input) {
    try {
        const senderDomain = await loadSenderDomain(input.db, input.inboundEmailProcessingId);
        if (!senderDomain) {
            console.warn(JSON.stringify({
                event: "c3c_example_index_skipped",
                reason: "sender_domain_unavailable",
                correctionId: input.correctionId,
            }));
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
            console.warn(JSON.stringify({
                event: "c3c_example_index_skipped",
                reason: built.reason,
                correctionId: input.correctionId,
            }));
            return { indexed: false, reason: built.reason };
        }
        const ref = input.db
            .collection(exports.FIELD_LESSON_EXAMPLE_COLLECTION)
            .doc(built.doc.exampleId);
        for (let attempt = 1; attempt <= MAX_INDEX_ATTEMPTS; attempt += 1) {
            try {
                await ref.create(built.doc);
                return { indexed: true, exampleId: built.doc.exampleId };
            }
            catch (err) {
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
                console.warn(JSON.stringify({
                    event: "c3c_example_index_failed",
                    correctionId: input.correctionId,
                    attempt,
                    error: err instanceof Error ? err.message : String(err),
                }));
                return { indexed: false, reason: "write_failed" };
            }
        }
        return { indexed: false, reason: "write_failed" };
    }
    catch (err) {
        console.warn(JSON.stringify({
            event: "c3c_example_index_failed",
            correctionId: input.correctionId,
            error: err instanceof Error ? err.message : String(err),
        }));
        return { indexed: false, reason: "write_failed" };
    }
}
//# sourceMappingURL=indexFieldLessonExample.js.map