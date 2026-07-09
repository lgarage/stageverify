"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyVendorPin = void 0;
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
const DEFAULT_VENDOR_SESSION_MINUTES = 15;
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function asJobId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function asStagingLocationCode(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32)
        return null;
    return trimmed;
}
function vendorDisplayName(vendor) {
    return vendor.name ?? vendor.vendorName ?? "Vendor";
}
async function resolveDeliveryId(deliveryId, orderId) {
    if (deliveryId)
        return deliveryId;
    if (!orderId)
        return null;
    const snap = await getDb()
        .collection("deliveries")
        .where("orderNumber", "==", orderId)
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    return snap.docs[0].id;
}
async function checkRateLimit(attemptKey) {
    const ref = getDb().collection("vendorPinAttempts").doc(attemptKey);
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
    await getDb().collection("vendorPinAttempts").doc(attemptKey).delete();
}
async function getVendorSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return DEFAULT_VENDOR_SESSION_MINUTES;
    const minutes = snap.data()
        .vendorSessionMinutes;
    if (typeof minutes === "number" &&
        Number.isFinite(minutes) &&
        minutes >= 5 &&
        minutes <= 480) {
        return minutes;
    }
    return DEFAULT_VENDOR_SESSION_MINUTES;
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
async function findJobByPin(pin) {
    const db = getDb();
    const pinCodeSnap = await db
        .collection("jobs")
        .where("pinCode", "==", pin)
        .limit(2)
        .get();
    if (pinCodeSnap.size === 1) {
        return { id: pinCodeSnap.docs[0].id, data: pinCodeSnap.docs[0].data() };
    }
    if (pinCodeSnap.size > 1)
        return null;
    const allJobs = await db.collection("jobs").limit(500).get();
    for (const doc of allJobs.docs) {
        const job = doc.data();
        if ((0, pinMatching_1.pinMatches)(job, pin)) {
            return { id: doc.id, data: job };
        }
    }
    return null;
}
async function primaryVendorForJob(jobId) {
    const snap = await getDb()
        .collection("deliveries")
        .where("jobId", "==", jobId)
        .limit(20)
        .get();
    if (snap.empty)
        return null;
    const doc = snap.docs[0];
    const delivery = doc.data();
    const vendorSnap = await getDb()
        .collection("vendors")
        .doc(delivery.vendorId)
        .get();
    const vendor = vendorSnap.exists
        ? vendorSnap.data()
        : { name: "Vendor" };
    return {
        vendorId: delivery.vendorId,
        vendorName: vendorDisplayName(vendor),
        deliveryId: doc.id,
    };
}
async function createVendorSession(input) {
    const sessionMinutes = await getVendorSessionMinutes();
    const now = Date.now();
    const expiresAt = new Date(now + sessionMinutes * 60 * 1000).toISOString();
    const sessionToken = (0, crypto_1.randomBytes)(32).toString("hex");
    await getDb().collection("vendorSessions").doc(sessionToken).set({
        id: sessionToken,
        deliveryId: input.deliveryId,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        sessionScope: input.sessionScope,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.scannedStagingLocationId
            ? { scannedStagingLocationId: input.scannedStagingLocationId }
            : {}),
        ...(input.scannedStagingLocationCode
            ? { scannedStagingLocationCode: input.scannedStagingLocationCode }
            : {}),
    });
    return { sessionToken, expiresAt };
}
async function writePinVerifiedAudit(input) {
    const now = new Date().toISOString();
    const eventId = `pin-${(0, crypto_1.createHash)("sha256")
        .update(`${input.deliveryId}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb().collection("pinVerificationEvents").doc(eventId).set({
        id: eventId,
        deliveryOrderId: input.deliveryId,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        pinVerified: true,
        action: "PIN_VERIFIED",
        timestamp: now,
        createdAt: now,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.stagingLocationCode
            ? { stagingLocationCode: input.stagingLocationCode }
            : {}),
    });
}
async function verifyLegacyDeliveryPin(deliveryId, pin) {
    const deliverySnap = await getDb()
        .collection("deliveries")
        .doc(deliveryId)
        .get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    const delivery = deliverySnap.data();
    const jobId = typeof delivery.jobId === "string" && delivery.jobId.trim()
        ? delivery.jobId.trim()
        : undefined;
    if (jobId) {
        const jobSnap = await getDb().collection("jobs").doc(jobId).get();
        if (jobSnap.exists) {
            const job = jobSnap.data();
            if ((0, pinMatching_1.pinMatches)(job, pin)) {
                const vendorSnap = await getDb()
                    .collection("vendors")
                    .doc(delivery.vendorId)
                    .get();
                const vendor = vendorSnap.exists
                    ? vendorSnap.data()
                    : { name: delivery.vendorName ?? "Vendor" };
                return {
                    vendorId: delivery.vendorId,
                    vendorName: vendorDisplayName(vendor),
                    deliveryId,
                    jobId,
                    pinMatchedVia: "job",
                };
            }
        }
    }
    const vendorSnap = await getDb()
        .collection("vendors")
        .doc(delivery.vendorId)
        .get();
    if (!vendorSnap.exists) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    const vendor = vendorSnap.data();
    if (vendor.active === false) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    if (!(0, pinMatching_1.pinMatches)(vendor, pin)) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    return {
        vendorId: delivery.vendorId,
        vendorName: vendorDisplayName(vendor),
        deliveryId,
        jobId,
        pinMatchedVia: "vendor",
    };
}
exports.verifyVendorPin = (0, https_1.onCall)({
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
    const explicitJobId = asJobId(data.jobId);
    const deliveryId = await resolveDeliveryId(asDeliveryId(data.deliveryId), asDeliveryId(data.orderId));
    if (!pin) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const locationFirst = Boolean(stagingLocationCode) && !deliveryId;
    if (!locationFirst && !deliveryId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const attemptKey = locationFirst
        ? `loc:${stagingLocationCode}`
        : `del:${deliveryId}`;
    await checkRateLimit(attemptKey);
    if (locationFirst) {
        await checkRateLimit("pin:location-first:global");
    }
    if (locationFirst) {
        const jobMatch = explicitJobId
            ? await (async () => {
                const snap = await getDb().collection("jobs").doc(explicitJobId).get();
                if (!snap.exists)
                    return null;
                const job = snap.data();
                return (0, pinMatching_1.pinMatches)(job, pin) ? { id: snap.id, data: job } : null;
            })()
            : await findJobByPin(pin);
        if (!jobMatch) {
            return { success: false, message: "Invalid code." };
        }
        const jobId = jobMatch.id;
        const vendorInfo = await primaryVendorForJob(jobId);
        if (!vendorInfo) {
            return { success: false, message: "Invalid code." };
        }
        const location = await resolveStagingLocation(stagingLocationCode);
        await clearRateLimitOnSuccess(attemptKey);
        if (locationFirst) {
            await clearRateLimitOnSuccess("pin:location-first:global");
        }
        await writePinVerifiedAudit({
            deliveryId: vendorInfo.deliveryId,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            jobId,
            stagingLocationCode: stagingLocationCode ?? undefined,
        });
        const session = await createVendorSession({
            deliveryId: vendorInfo.deliveryId,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            sessionScope: "job",
            jobId,
            scannedStagingLocationId: location?.id,
            scannedStagingLocationCode: location?.code ?? stagingLocationCode ?? undefined,
        });
        return {
            success: true,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            deliveryId: vendorInfo.deliveryId,
            jobId,
            sessionScope: "job",
            scannedStagingLocationCode: location?.code ?? stagingLocationCode,
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
        };
    }
    let verified;
    try {
        verified = await verifyLegacyDeliveryPin(deliveryId, pin);
    }
    catch {
        return { success: false, message: "Invalid code." };
    }
    await clearRateLimitOnSuccess(attemptKey);
    await writePinVerifiedAudit({
        deliveryId: verified.deliveryId,
        vendorId: verified.vendorId,
        vendorName: verified.vendorName,
        jobId: verified.jobId,
    });
    const sessionScope = verified.pinMatchedVia === "job" && verified.jobId ? "job" : "delivery";
    const session = await createVendorSession({
        deliveryId: verified.deliveryId,
        vendorId: verified.vendorId,
        vendorName: verified.vendorName,
        sessionScope,
        jobId: sessionScope === "job" ? verified.jobId : undefined,
    });
    return {
        success: true,
        vendorId: verified.vendorId,
        vendorName: verified.vendorName,
        deliveryId: verified.deliveryId,
        jobId: sessionScope === "job" ? verified.jobId : undefined,
        sessionScope,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
    };
});
//# sourceMappingURL=verifyVendorPin.js.map