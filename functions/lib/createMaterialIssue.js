"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMaterialIssue = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
function getDb() {
    return admin.firestore();
}
const MATERIAL_ISSUE_TYPES = new Set([
    "missing",
    "wrong_item",
    "damaged",
    "backordered",
    "other",
]);
const PICKUP_ELIGIBLE_STATUSES = new Set([
    "ready_for_pickup",
    "complete",
    "partial",
]);
const OPEN_ISSUE_STATUSES = ["open", "assigned"];
const MAX_OPEN_ISSUES_PER_DELIVERY = 10;
const MAX_REPORTED_BY_LEN = 128;
const MAX_DESCRIPTION_LEN = 500;
const MAX_CLIENT_REQUEST_ID_LEN = 64;
const MIN_SUBMIT_INTERVAL_MS = 5_000;
const MAX_SUBMITS_PER_DELIVERY_WINDOW = 5;
const SUBMIT_WINDOW_MS = 60_000;
function isBlockingType(type) {
    return type !== "other";
}
function effectiveOwner(job, delivery) {
    if (delivery.materialOwnerId) {
        return {
            id: delivery.materialOwnerId,
            name: delivery.materialOwnerName ?? "Unassigned",
        };
    }
    if (job?.materialOwnerId) {
        return {
            id: job.materialOwnerId,
            name: job.materialOwnerName ?? "Unassigned",
        };
    }
    return { id: null, name: "Unassigned" };
}
function asNonEmptyString(value, maxLen) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLen)
        return null;
    return trimmed;
}
exports.createMaterialIssue = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, 128);
    const jobId = asNonEmptyString(data.jobId, 128);
    const typeRaw = asNonEmptyString(data.type, 32);
    const reportedBy = asNonEmptyString(data.reportedBy, MAX_REPORTED_BY_LEN);
    const clientRequestId = asNonEmptyString(data.clientRequestId, MAX_CLIENT_REQUEST_ID_LEN);
    if (!deliveryOrderId || !jobId || !typeRaw || !reportedBy || !clientRequestId) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId, jobId, type, reportedBy, and clientRequestId are required.");
    }
    if (!MATERIAL_ISSUE_TYPES.has(typeRaw)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid issue type.");
    }
    const type = typeRaw;
    const description = data.description === undefined || data.description === ""
        ? undefined
        : asNonEmptyString(data.description, MAX_DESCRIPTION_LEN);
    if (data.description && !description) {
        throw new https_1.HttpsError("invalid-argument", "Description is too long.");
    }
    const itemId = data.itemId === undefined || data.itemId === ""
        ? undefined
        : asNonEmptyString(data.itemId, 128);
    if (data.itemId && !itemId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid itemId.");
    }
    const existingByRequest = await getDb()
        .collection("materialIssues")
        .where("deliveryOrderId", "==", deliveryOrderId)
        .where("clientRequestId", "==", clientRequestId)
        .limit(1)
        .get();
    if (!existingByRequest.empty) {
        const doc = existingByRequest.docs[0];
        const issue = doc.data();
        return {
            issueId: doc.id,
            status: issue.status,
            assignedOwnerId: issue.assignedOwnerId ?? undefined,
            assignedOwnerName: issue.assignedOwnerName ?? "Unassigned",
            blocking: issue.blocking === true,
            duplicate: true,
        };
    }
    const deliveryRef = getDb().collection("deliveries").doc(deliveryOrderId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    if (delivery.jobId !== jobId) {
        throw new https_1.HttpsError("permission-denied", "Delivery does not belong to this job.");
    }
    if (!PICKUP_ELIGIBLE_STATUSES.has(delivery.status)) {
        throw new https_1.HttpsError("failed-precondition", `Cannot report an issue while delivery status is "${delivery.status}".`);
    }
    if (itemId) {
        const itemSnap = await getDb().collection("items").doc(itemId).get();
        if (!itemSnap.exists) {
            throw new https_1.HttpsError("not-found", "Item not found.");
        }
        const item = itemSnap.data();
        if (item?.deliveryOrderId !== deliveryOrderId) {
            throw new https_1.HttpsError("permission-denied", "Item does not belong to this delivery.");
        }
    }
    const openIssuesSnap = await getDb()
        .collection("materialIssues")
        .where("deliveryOrderId", "==", deliveryOrderId)
        .where("status", "in", [...OPEN_ISSUE_STATUSES])
        .get();
    if (openIssuesSnap.size >= MAX_OPEN_ISSUES_PER_DELIVERY) {
        throw new https_1.HttpsError("resource-exhausted", `Maximum of ${MAX_OPEN_ISSUES_PER_DELIVERY} open issues per delivery.`);
    }
    const duplicateOpen = openIssuesSnap.docs.find((docSnap) => {
        const issue = docSnap.data();
        if (issue.type !== type)
            return false;
        if (itemId)
            return issue.itemId === itemId;
        return !issue.itemId;
    });
    if (duplicateOpen) {
        const issue = duplicateOpen.data();
        return {
            issueId: duplicateOpen.id,
            status: issue.status,
            assignedOwnerId: issue.assignedOwnerId ?? undefined,
            assignedOwnerName: issue.assignedOwnerName ?? "Unassigned",
            blocking: issue.blocking === true,
            duplicate: true,
        };
    }
    const recentInWindow = openIssuesSnap.docs.filter((docSnap) => {
        const createdAt = docSnap.data().createdAt;
        if (typeof createdAt !== "string")
            return false;
        return Date.parse(createdAt) >= Date.now() - SUBMIT_WINDOW_MS;
    });
    if (recentInWindow.length >= MAX_SUBMITS_PER_DELIVERY_WINDOW) {
        throw new https_1.HttpsError("resource-exhausted", "Too many issue reports for this delivery. Try again later.");
    }
    const lastCreated = openIssuesSnap.docs
        .map((docSnap) => docSnap.data().createdAt)
        .filter((value) => typeof value === "string")
        .sort((a, b) => b.localeCompare(a))[0];
    if (lastCreated &&
        Date.now() - Date.parse(lastCreated) < MIN_SUBMIT_INTERVAL_MS) {
        throw new https_1.HttpsError("resource-exhausted", "Please wait a few seconds before reporting another issue.");
    }
    const jobSnap = await getDb().collection("jobs").doc(jobId).get();
    const job = jobSnap.exists ? jobSnap.data() : undefined;
    const owner = effectiveOwner(job, delivery);
    const blocking = isBlockingType(type);
    const now = new Date().toISOString();
    const issueId = crypto.randomUUID();
    const status = owner.id ? "assigned" : "open";
    const issuePayload = {
        id: issueId,
        deliveryOrderId,
        jobId,
        type,
        status,
        reportedBy,
        assignedOwnerName: owner.name,
        blocking,
        clientRequestId,
        createdAt: now,
        updatedAt: now,
    };
    if (owner.id)
        issuePayload.assignedOwnerId = owner.id;
    if (description)
        issuePayload.description = description;
    if (itemId)
        issuePayload.itemId = itemId;
    await getDb().runTransaction(async (tx) => {
        const liveDelivery = await tx.get(deliveryRef);
        if (!liveDelivery.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const liveData = liveDelivery.data();
        const prevOpen = liveData.openIssueCount ?? 0;
        const prevBlocking = liveData.openBlockingIssueCount ?? 0;
        tx.set(getDb().collection("materialIssues").doc(issueId), issuePayload);
        tx.update(deliveryRef, {
            openIssueCount: prevOpen + 1,
            openBlockingIssueCount: prevBlocking + (blocking ? 1 : 0),
            updatedAt: now,
        });
    });
    return {
        issueId,
        status,
        assignedOwnerId: owner.id ?? undefined,
        assignedOwnerName: owner.name,
        blocking,
        duplicate: false,
    };
});
//# sourceMappingURL=createMaterialIssue.js.map