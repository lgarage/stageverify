"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPinAccessAudit = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
/** Manager paginated PIN access audit — never includes PIN values. */
exports.listPinAccessAudit = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const limit = (0, dispatcherAuth_1.clampListLimit)(data.limit, 25, 100);
    const startAfter = typeof data.startAfterCreatedAt === "string"
        ? data.startAfterCreatedAt.trim()
        : "";
    let query = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.PIN_ACCESS_AUDIT_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(limit);
    if (startAfter) {
        query = query.startAfter(startAfter);
    }
    const snap = await query.get();
    const entries = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
    }));
    const lastCreatedAt = entries.length > 0 ? entries[entries.length - 1].createdAt : null;
    return {
        entries,
        nextStartAfterCreatedAt: lastCreatedAt,
        hasMore: entries.length === limit,
    };
});
//# sourceMappingURL=listPinAccessAudit.js.map