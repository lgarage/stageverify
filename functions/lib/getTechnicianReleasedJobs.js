"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTechnicianReleasedJobs = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const technicianSessionValidation_1 = require("./technicianSessionValidation");
function getDb() {
    return admin.firestore();
}
async function loadSession(sessionToken) {
    const snap = await getDb()
        .collection("technicianSessions")
        .doc(sessionToken)
        .get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    const expiresMs = Date.parse(data.expiresAt);
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    return data;
}
function allStagingIds(delivery) {
    const ids = [];
    if (delivery.stagingLocationId?.trim()) {
        ids.push(delivery.stagingLocationId.trim());
    }
    if (delivery.additionalStagingLocationIds?.length) {
        ids.push(...delivery.additionalStagingLocationIds);
    }
    return ids;
}
/** Always-strict: returns only day-released jobs (empty array when none). */
exports.getTechnicianReleasedJobs = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, technicianSessionValidation_1.asTechnicianSessionToken)(data.sessionToken);
    if (!sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await loadSession(sessionToken);
    if (!session) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    const releaseDate = (0, technicianSessionValidation_1.todayReleaseDateUtc)();
    const release = await (0, technicianSessionValidation_1.loadTechnicianDayRelease)(session.technicianId, releaseDate);
    const jobIds = release?.jobIds ?? [];
    if (jobIds.length === 0) {
        return {
            jobs: [],
            releaseDate,
            scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
            technicianName: session.technicianName,
        };
    }
    const stagingSnap = await getDb()
        .collection("stagingLocations")
        .limit(500)
        .get();
    const codeById = new Map();
    for (const doc of stagingSnap.docs) {
        const code = String(doc.data().code ?? doc.id);
        codeById.set(doc.id, code);
    }
    const jobs = [];
    for (const jobId of jobIds) {
        const jobSnap = await getDb().collection("jobs").doc(jobId).get();
        const jobData = jobSnap.exists ? jobSnap.data() : {};
        const jobName = jobData.jobName?.trim() ||
            jobData.name?.trim() ||
            jobId;
        const deliveriesSnap = await getDb()
            .collection("deliveries")
            .where("jobId", "==", jobId)
            .limit(100)
            .get();
        const locationIdSet = new Set();
        let deliveryCount = 0;
        let readyForPickupCount = 0;
        for (const doc of deliveriesSnap.docs) {
            const delivery = doc.data();
            deliveryCount += 1;
            if (delivery.status === "ready_for_pickup") {
                readyForPickupCount += 1;
            }
            for (const locId of allStagingIds(delivery)) {
                locationIdSet.add(locId);
            }
        }
        const stagingLocationCodes = [...locationIdSet]
            .map((id) => codeById.get(id) ?? id)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        jobs.push({
            jobId,
            jobName,
            stagingLocationCodes,
            deliveryCount,
            readyForPickupCount,
        });
    }
    jobs.sort((a, b) => {
        const aScanned = session.scannedStagingLocationCode &&
            a.stagingLocationCodes.includes(session.scannedStagingLocationCode)
            ? 0
            : 1;
        const bScanned = session.scannedStagingLocationCode &&
            b.stagingLocationCodes.includes(session.scannedStagingLocationCode)
            ? 0
            : 1;
        if (aScanned !== bScanned)
            return aScanned - bScanned;
        return a.jobName.localeCompare(b.jobName);
    });
    return {
        jobs,
        releaseDate,
        scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
        technicianName: session.technicianName,
    };
});
//# sourceMappingURL=getTechnicianReleasedJobs.js.map