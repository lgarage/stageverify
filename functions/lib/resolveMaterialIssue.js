"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMaterialIssue = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const pickupMaterialIssueReadback_1 = require("./pickupMaterialIssueReadback");
function getDb() {
    return admin.firestore();
}
const OPEN_ISSUE_STATUSES = ["open", "assigned"];
const MAX_NOTE_LEN = 500;
const RESOLUTION_TYPES = [
    "found_in_shop",
    "pick_up_supply_house",
    "vendor_redeliver",
    "substitute",
    "transfer",
    "continue_without",
    "hold_job",
    "other",
    "need_more_information",
];
function asNonEmptyString(value, maxLen) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLen)
        return null;
    return trimmed;
}
function asResolutionType(value) {
    if (typeof value !== "string")
        return null;
    return RESOLUTION_TYPES.includes(value)
        ? value
        : null;
}
function isBlockingType(type) {
    return type !== "other" && type !== "running_low";
}
/** Authenticated dispatcher resolves a material issue; recalculates readiness when eligible. */
exports.resolveMaterialIssue = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("permission-denied", "Sign in as a dispatcher to resolve issues.");
    }
    const data = (request.data ?? {});
    const issueId = asNonEmptyString(data.issueId, 128);
    const resolutionType = asResolutionType(data.resolutionType);
    const resolutionNote = asNonEmptyString(data.resolutionNote ?? "Resolved", MAX_NOTE_LEN);
    if (!issueId || !resolutionType || !resolutionNote) {
        throw new https_1.HttpsError("invalid-argument", "issueId, resolutionType, and resolutionNote are required.");
    }
    const issueRef = getDb().collection("materialIssues").doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
        throw new https_1.HttpsError("not-found", "Issue not found.");
    }
    const issue = issueSnap.data();
    if (!OPEN_ISSUE_STATUSES.includes(issue.status)) {
        throw new https_1.HttpsError("failed-precondition", "Issue is not open or assigned.");
    }
    const deliveryOrderId = issue.deliveryOrderId;
    const deliveryRef = getDb().collection("deliveries").doc(deliveryOrderId);
    const now = new Date().toISOString();
    const resolvedBy = request.auth.token.email?.trim() ||
        request.auth.token.name?.trim() ||
        request.auth.uid;
    const blocking = issue.blocking === true;
    await getDb().runTransaction(async (tx) => {
        const liveIssue = await tx.get(issueRef);
        if (!liveIssue.exists) {
            throw new https_1.HttpsError("not-found", "Issue not found.");
        }
        const liveData = liveIssue.data();
        if (!OPEN_ISSUE_STATUSES.includes(liveData.status)) {
            throw new https_1.HttpsError("failed-precondition", "Issue is not open or assigned.");
        }
        const liveDelivery = await tx.get(deliveryRef);
        if (!liveDelivery.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const delivery = liveDelivery.data();
        const prevOpen = delivery.openIssueCount ?? 0;
        const prevBlocking = delivery.openBlockingIssueCount ?? 0;
        tx.update(issueRef, {
            status: "resolved",
            resolutionType,
            resolutionNote,
            resolvedAt: now,
            resolvedBy,
            updatedAt: now,
        });
        const pickupMaterialIssues = (0, pickupMaterialIssueReadback_1.resolvePickupMaterialIssueReadback)(delivery.pickupMaterialIssues, issueId, { resolutionType, resolutionNote, resolvedAt: now });
        tx.update(deliveryRef, {
            openIssueCount: Math.max(0, prevOpen - 1),
            openBlockingIssueCount: blocking
                ? Math.max(0, prevBlocking - 1)
                : prevBlocking,
            pickupMaterialIssues,
            updatedAt: now,
        });
    });
    let readinessRecalculated = false;
    const openSnap = await getDb()
        .collection("materialIssues")
        .where("deliveryOrderId", "==", deliveryOrderId)
        .where("status", "in", [...OPEN_ISSUE_STATUSES])
        .get();
    const hasBlockingOpen = openSnap.docs.some((docSnap) => {
        const row = docSnap.data();
        return row.blocking === true || isBlockingType(String(row.type ?? ""));
    });
    if (!hasBlockingOpen) {
        try {
            await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(getDb(), deliveryOrderId);
            readinessRecalculated = true;
        }
        catch {
            readinessRecalculated = false;
        }
    }
    return {
        issueId,
        status: "resolved",
        resolutionType,
        readinessRecalculated,
    };
});
//# sourceMappingURL=resolveMaterialIssue.js.map