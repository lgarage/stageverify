"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateVendorInvoiceFieldLessonCandidates = void 0;
/**
 * Lane C C3-D.1 — Manager/Admin evaluate callable (no activate, no parse effect).
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const evaluateFieldLessonCandidate_1 = require("./invoice/reviewChat/evaluateFieldLessonCandidate");
const correctionAllowlist_1 = require("./invoice/reviewChat/correctionAllowlist");
function getDb() {
    return admin.firestore();
}
exports.evaluateVendorInvoiceFieldLessonCandidates = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const results = [];
    if (data.evaluateRecent === true) {
        const limit = typeof data.recentLimit === "number" ? data.recentLimit : 30;
        const keys = await (0, evaluateFieldLessonCandidate_1.listRecentExampleScopeKeys)(getDb(), limit);
        for (const sk of keys) {
            const parsed = (0, evaluateFieldLessonCandidate_1.parseScopeKey)(sk);
            if (!parsed)
                continue;
            results.push(await (0, evaluateFieldLessonCandidate_1.evaluateFieldLessonScope)({
                db: getDb(),
                scope: parsed,
                actorUid: uid,
            }));
        }
        return { results, count: results.length };
    }
    let scope = null;
    if (typeof data.scopeKey === "string" && data.scopeKey.trim()) {
        scope = (0, evaluateFieldLessonCandidate_1.parseScopeKey)(data.scopeKey.trim());
        if (!scope) {
            throw new https_1.HttpsError("invalid-argument", "Invalid scopeKey.");
        }
    }
    else {
        const vendorKey = typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
        const parserFormatId = typeof data.parserFormatId === "string"
            ? data.parserFormatId.trim()
            : "";
        const senderDomain = typeof data.senderDomain === "string"
            ? data.senderDomain.trim().toLowerCase()
            : "";
        const field = typeof data.field === "string" ? data.field.trim() : "";
        if (!vendorKey || !parserFormatId || !senderDomain || !field) {
            throw new https_1.HttpsError("invalid-argument", "Provide scopeKey or vendorKey+parserFormatId+senderDomain+field (or evaluateRecent:true).");
        }
        if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(field)) {
            throw new https_1.HttpsError("invalid-argument", "Unsupported field.");
        }
        scope = { vendorKey, parserFormatId, senderDomain, field };
    }
    const result = await (0, evaluateFieldLessonCandidate_1.evaluateFieldLessonScope)({
        db: getDb(),
        scope,
        actorUid: uid,
    });
    return { results: [result], count: 1 };
});
//# sourceMappingURL=evaluateVendorInvoiceFieldLessonScopeApi.js.map