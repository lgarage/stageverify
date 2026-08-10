"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVendorInvoiceFieldLessonStatus = void 0;
/**
 * Lane C C3-D.2 — Manager lifecycle callable (activate/reject/suspend/reactivate).
 * No parse effect. No auto-activate.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const fieldLessonLifecycle_1 = require("./invoice/reviewChat/fieldLessonLifecycle");
function getDb() {
    return admin.firestore();
}
const ACTIONS = [
    "activate",
    "reject",
    "suspend",
    "reactivate",
];
function parseAction(raw) {
    return typeof raw === "string" &&
        ACTIONS.includes(raw.trim())
        ? raw.trim()
        : null;
}
exports.setVendorInvoiceFieldLessonStatus = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const lessonId = typeof data.lessonId === "string" ? data.lessonId.trim() : "";
    const action = parseAction(data.action);
    const expectedVersion = typeof data.expectedVersion === "number" &&
        Number.isFinite(data.expectedVersion)
        ? Math.floor(data.expectedVersion)
        : null;
    const idempotencyKey = typeof data.idempotencyKey === "string"
        ? data.idempotencyKey.trim()
        : "";
    const note = typeof data.note === "string" ? data.note.trim().slice(0, 500) : undefined;
    if (!lessonId) {
        throw new https_1.HttpsError("invalid-argument", "lessonId is required.");
    }
    if (!action) {
        throw new https_1.HttpsError("invalid-argument", "action must be activate|reject|suspend|reactivate.");
    }
    if (expectedVersion == null || expectedVersion < 1) {
        throw new https_1.HttpsError("invalid-argument", "expectedVersion must be a positive integer.");
    }
    if (!idempotencyKey) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    const lifecycleRequest = {
        lessonId,
        action,
        expectedVersion,
        idempotencyKey,
        note,
        actorUid: uid,
    };
    const outcome = await (0, fieldLessonLifecycle_1.applyFieldLessonStatusTransition)({
        db: getDb(),
        request: lifecycleRequest,
    });
    if (!outcome.ok) {
        switch (outcome.code) {
            case "not_found":
                throw new https_1.HttpsError("not-found", outcome.message);
            case "lesson_version_mismatch":
                throw new https_1.HttpsError("failed-precondition", "lesson_version_mismatch");
            case "invalid_transition":
                throw new https_1.HttpsError("failed-precondition", outcome.message);
            case "revalidation_failed":
                throw new https_1.HttpsError("failed-precondition", outcome.message || "revalidation_failed");
            default:
                throw new https_1.HttpsError("internal", "Lifecycle transition failed.");
        }
    }
    return outcome.result;
});
//# sourceMappingURL=setVendorInvoiceFieldLessonStatusApi.js.map