"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asTechnicianSessionToken = asTechnicianSessionToken;
exports.todayReleaseDateUtc = todayReleaseDateUtc;
exports.loadTechnicianDayRelease = loadTechnicianDayRelease;
exports.assertTechnicianSessionForJobPickup = assertTechnicianSessionForJobPickup;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
function getDb() {
    return admin.firestore();
}
function asTechnicianSessionToken(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-f0-9]{64}$/.test(trimmed))
        return null;
    return trimmed;
}
function todayReleaseDateUtc() {
    return new Date().toISOString().slice(0, 10);
}
async function loadSession(sessionToken) {
    const snap = await getDb()
        .collection("technicianSessions")
        .doc(sessionToken)
        .get();
    if (!snap.exists)
        return null;
    return snap.data();
}
function assertNotExpired(session) {
    const expiresMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
}
async function loadTechnicianDayRelease(technicianId, releaseDate) {
    const docId = `${technicianId}_${releaseDate}`;
    const snap = await getDb()
        .collection("technicianDayReleases")
        .doc(docId)
        .get();
    if (!snap.exists)
        return null;
    return snap.data();
}
/** Validates technician session and that jobId is day-released (always-strict). */
async function assertTechnicianSessionForJobPickup(sessionToken, jobId, releaseDate = todayReleaseDateUtc()) {
    const session = await loadSession(sessionToken);
    if (!session) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    assertNotExpired(session);
    const release = await loadTechnicianDayRelease(session.technicianId, releaseDate);
    const jobIds = release?.jobIds ?? [];
    if (!jobIds.includes(jobId)) {
        throw new https_1.HttpsError("permission-denied", "This job is not released for you today.");
    }
    return session;
}
//# sourceMappingURL=technicianSessionValidation.js.map