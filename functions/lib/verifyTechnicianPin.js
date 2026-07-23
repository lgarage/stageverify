"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTechnicianPin = void 0;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const pinMatching_1 = require("./pinMatching");
function getDb() {
    return admin.firestore();
}
const MAX_ATTEMPTS_PER_WINDOW = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ATTEMPT_INTERVAL_MS = 750;
const DEFAULT_TECHNICIAN_SESSION_MINUTES = 15;
function asStagingLocationCode(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32)
        return null;
    return trimmed;
}
async function checkRateLimit(attemptKey) {
    const ref = getDb().collection("technicianPinAttempts").doc(attemptKey);
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
    await getDb().collection("technicianPinAttempts").doc(attemptKey).delete();
}
async function getTechnicianSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return DEFAULT_TECHNICIAN_SESSION_MINUTES;
    const minutes = snap.data()
        .technicianSessionMinutes;
    if (typeof minutes === "number" &&
        Number.isFinite(minutes) &&
        minutes >= 5 &&
        minutes <= 480) {
        return minutes;
    }
    return DEFAULT_TECHNICIAN_SESSION_MINUTES;
}
async function findTechnicianByPin(pin) {
    const db = getDb();
    const pinCodeSnap = await db
        .collection("technicians")
        .where("pinCode", "==", pin)
        .limit(2)
        .get();
    if (pinCodeSnap.size === 1) {
        const doc = pinCodeSnap.docs[0];
        const data = doc.data();
        if (data.active === false)
            return null;
        if (data.permissions?.doorScan === false)
            return null;
        return { id: doc.id, data };
    }
    if (pinCodeSnap.size > 1)
        return null;
    const all = await db.collection("technicians").limit(200).get();
    for (const doc of all.docs) {
        const tech = doc.data();
        if (tech.active === false)
            continue;
        if (tech.permissions?.doorScan === false)
            continue;
        if ((0, pinMatching_1.pinMatches)(tech, pin)) {
            return { id: doc.id, data: tech };
        }
    }
    return null;
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
exports.verifyTechnicianPin = (0, https_1.onCall)({
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
    const attemptKey = `loc:${stagingLocationCode}`;
    await checkRateLimit(attemptKey);
    await checkRateLimit("pin:technician:global");
    const match = await findTechnicianByPin(pin);
    if (!match) {
        return { success: false, message: "Invalid code." };
    }
    const location = await resolveStagingLocation(stagingLocationCode);
    const technicianName = match.data.name?.trim() || "Technician";
    const sessionMinutes = await getTechnicianSessionMinutes();
    const now = Date.now();
    const expiresAt = new Date(now + sessionMinutes * 60 * 1000).toISOString();
    const sessionToken = (0, crypto_1.randomBytes)(32).toString("hex");
    await getDb().collection("technicianSessions").doc(sessionToken).set({
        id: sessionToken,
        technicianId: match.id,
        technicianName,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
    });
    const eventId = `tech-pin-${(0, crypto_1.createHash)("sha256")
        .update(`${match.id}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb().collection("pinVerificationEvents").doc(eventId).set({
        id: eventId,
        technicianId: match.id,
        technicianName,
        pinVerified: true,
        action: "TECH_PIN_VERIFIED",
        timestamp: new Date(now).toISOString(),
        createdAt: new Date(now).toISOString(),
        stagingLocationCode: location?.code ?? stagingLocationCode,
    });
    await clearRateLimitOnSuccess(attemptKey);
    await clearRateLimitOnSuccess("pin:technician:global");
    return {
        success: true,
        technicianId: match.id,
        technicianName,
        sessionToken,
        expiresAt,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
    };
});
//# sourceMappingURL=verifyTechnicianPin.js.map