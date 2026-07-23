"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyManagementPin = void 0;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const pinMatching_1 = require("./pinMatching");
const managementSessionValidation_1 = require("./managementSessionValidation");
function getDb() {
    return admin.firestore();
}
const MAX_ATTEMPTS_PER_WINDOW = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ATTEMPT_INTERVAL_MS = 750;
const DEFAULT_MANAGEMENT_SESSION_MINUTES = 30;
function asStagingLocationCode(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32)
        return null;
    return trimmed;
}
async function checkRateLimit(attemptKey) {
    const ref = getDb().collection("managementPinAttempts").doc(attemptKey);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {});
        const windowStart = data.windowStartedAt
            ? Date.parse(data.windowStartedAt)
            : now;
        const inWindow = now - windowStart < ATTEMPT_WINDOW_MS;
        const count = inWindow ? (data.count ?? 0) : 0;
        if (inWindow && count >= MAX_ATTEMPTS_PER_WINDOW) {
            throw new https_1.HttpsError("resource-exhausted", "Too many attempts. Try again later.");
        }
        const lastAttempt = data.lastAttemptAt
            ? Date.parse(data.lastAttemptAt)
            : 0;
        if (lastAttempt && now - lastAttempt < MIN_ATTEMPT_INTERVAL_MS) {
            throw new https_1.HttpsError("resource-exhausted", "Please wait a moment before trying again.");
        }
        tx.set(ref, {
            count: inWindow ? count + 1 : 1,
            windowStartedAt: inWindow
                ? data.windowStartedAt ?? nowIso
                : nowIso,
            lastAttemptAt: nowIso,
        }, { merge: true });
    });
}
async function clearRateLimitOnSuccess(attemptKey) {
    await getDb().collection("managementPinAttempts").doc(attemptKey).delete();
}
async function getManagementSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return DEFAULT_MANAGEMENT_SESSION_MINUTES;
    const minutes = snap.data()
        .managementSessionMinutes;
    if (typeof minutes === "number" &&
        Number.isFinite(minutes) &&
        minutes >= 5 &&
        minutes <= 480) {
        return minutes;
    }
    return DEFAULT_MANAGEMENT_SESSION_MINUTES;
}
async function resolveStagingLocation(code) {
    const snap = await getDb()
        .collection("stagingLocations")
        .where("code", "==", code)
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    const doc = snap.docs[0];
    return { id: doc.id, code: String(doc.data().code ?? code) };
}
exports.verifyManagementPin = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const pin = (0, pinMatching_1.asFourDigitPin)(data.pin);
    const stagingLocationCode = asStagingLocationCode(data.stagingLocationCode);
    if (!pin || !stagingLocationCode) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const config = await (0, managementSessionValidation_1.loadCatchAllConfig)();
    if (!config) {
        throw new https_1.HttpsError("failed-precondition", "Catch-all parcel intake is not enabled.");
    }
    const location = await resolveStagingLocation(stagingLocationCode);
    if (!location) {
        throw new https_1.HttpsError("failed-precondition", "Unknown staging location.");
    }
    const settingsSnap = await getDb().collection("appSettings").doc("config").get();
    const settings = settingsSnap.data();
    const secretSnap = await getDb()
        .collection("managementPinSecrets")
        .doc("config")
        .get();
    const secretData = secretSnap.data();
    const pinHash = secretData?.managementPinHash?.trim() ??
        settings?.managementPinHash?.trim() ??
        "";
    if (!pinHash && settings?.managementPinConfigured !== true) {
        throw new https_1.HttpsError("failed-precondition", "Management PIN is not configured.");
    }
    if (!pinHash) {
        throw new https_1.HttpsError("failed-precondition", "Management PIN is not configured.");
    }
    const attemptKey = `loc:${stagingLocationCode}`;
    await checkRateLimit(attemptKey);
    await checkRateLimit("pin:management:global");
    if (!(0, pinMatching_1.pinMatches)({ pinHash }, pin)) {
        return { success: false, message: "Invalid code." };
    }
    const sessionMinutes = await getManagementSessionMinutes();
    const now = Date.now();
    const expiresAt = new Date(now + sessionMinutes * 60 * 1000).toISOString();
    const sessionToken = (0, crypto_1.randomBytes)(32).toString("hex");
    await getDb().collection("managementSessions").doc(sessionToken).set({
        id: sessionToken,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        scannedStagingLocationCode: location.code,
        scannedStagingLocationId: location.id,
    });
    const eventId = `mgmt-pin-${(0, crypto_1.createHash)("sha256")
        .update(`${location.id}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb().collection("pinVerificationEvents").doc(eventId).set({
        id: eventId,
        pinVerified: true,
        action: "MANAGEMENT_PIN_VERIFIED",
        timestamp: new Date(now).toISOString(),
        createdAt: new Date(now).toISOString(),
        stagingLocationCode: location.code,
    });
    await clearRateLimitOnSuccess(attemptKey);
    await clearRateLimitOnSuccess("pin:management:global");
    return {
        success: true,
        sessionToken,
        expiresAt,
        scannedStagingLocationCode: location.code,
    };
});
//# sourceMappingURL=verifyManagementPin.js.map