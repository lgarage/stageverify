"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseJobsToTechnician = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const technicianSessionValidation_1 = require("./technicianSessionValidation");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function getDb() {
    return admin.firestore();
}
function asTechnicianId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
function asReleaseDate(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
        return null;
    return trimmed;
}
function asJobIdArray(value) {
    if (!Array.isArray(value))
        return null;
    if (value.length > 50)
        return null;
    const out = [];
    for (const entry of value) {
        if (typeof entry !== "string")
            return null;
        const trimmed = entry.trim();
        if (!trimmed || trimmed.length > 128)
            return null;
        if (!out.includes(trimmed))
            out.push(trimmed);
    }
    return out;
}
/** Dispatcher-only: release job(s) to a technician for a day (always-strict source). */
exports.releaseJobsToTechnician = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const technicianId = asTechnicianId(data.technicianId);
    const jobIds = asJobIdArray(data.jobIds);
    const releaseDate = asReleaseDate(data.releaseDate) ?? (0, technicianSessionValidation_1.todayReleaseDateUtc)();
    if (!technicianId || jobIds === null) {
        throw new https_1.HttpsError("invalid-argument", "technicianId and jobIds array are required.");
    }
    const techSnap = await getDb()
        .collection("technicians")
        .doc(technicianId)
        .get();
    if (!techSnap.exists || techSnap.data()?.active === false) {
        throw new https_1.HttpsError("not-found", "Technician not found.");
    }
    for (const jobId of jobIds) {
        const jobSnap = await getDb().collection("jobs").doc(jobId).get();
        if (!jobSnap.exists) {
            throw new https_1.HttpsError("not-found", `Job not found: ${jobId}`);
        }
    }
    const docId = `${technicianId}_${releaseDate}`;
    const now = new Date().toISOString();
    const existing = await getDb()
        .collection("technicianDayReleases")
        .doc(docId)
        .get();
    await getDb()
        .collection("technicianDayReleases")
        .doc(docId)
        .set({
        id: docId,
        technicianId,
        releaseDate,
        jobIds,
        updatedAt: now,
        updatedBy: uid,
        createdAt: existing.exists
            ? existing.data()?.createdAt ?? now
            : now,
    }, { merge: true });
    return {
        success: true,
        technicianId,
        releaseDate,
        jobIds,
    };
});
//# sourceMappingURL=releaseJobsToTechnician.js.map