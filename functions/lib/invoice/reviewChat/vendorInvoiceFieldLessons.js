"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScopeKey = exports.FIELD_LESSON_EVALUATOR_VERSION = exports.MIN_DISTINCT_DOCUMENT_VOTES = exports.FIELD_LESSON_CATEGORY = exports.FIELD_LESSON_COLLECTION = void 0;
exports.hashPatternFingerprint = hashPatternFingerprint;
exports.hashTextWindow = hashTextWindow;
exports.buildLessonDocId = buildLessonDocId;
/**
 * Lane C C3-D — vendorInvoiceFieldLessons collection types (lifecycle control-plane).
 * No parse effect. D.1 evaluator writes proposed | suspended only; D.2 Manager lifecycle adds active | rejected.
 */
const crypto_1 = require("crypto");
const indexFieldLessonExample_1 = require("./indexFieldLessonExample");
Object.defineProperty(exports, "buildScopeKey", { enumerable: true, get: function () { return indexFieldLessonExample_1.buildScopeKey; } });
exports.FIELD_LESSON_COLLECTION = "vendorInvoiceFieldLessons";
exports.FIELD_LESSON_CATEGORY = "header_field_extraction";
exports.MIN_DISTINCT_DOCUMENT_VOTES = 3;
exports.FIELD_LESSON_EVALUATOR_VERSION = "c3d1-v1";
function hashPatternFingerprint(patternFingerprint) {
    return (0, crypto_1.createHash)("sha256")
        .update(patternFingerprint, "utf8")
        .digest("hex")
        .slice(0, 16);
}
function hashTextWindow(text) {
    return (0, crypto_1.createHash)("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
function buildLessonDocId(input) {
    const scopeKey = (0, indexFieldLessonExample_1.buildScopeKey)({
        vendorKey: input.vendorKey,
        parserFormatId: input.parserFormatId,
        senderDomain: input.senderDomain,
        field: input.field,
    });
    const hash = hashPatternFingerprint(input.patternFingerprint);
    return `${scopeKey}__${hash}`;
}
//# sourceMappingURL=vendorInvoiceFieldLessons.js.map