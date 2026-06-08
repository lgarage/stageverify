"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyVendorPin = void 0;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
function getDb() {
    return admin.firestore();
}
const PIN_LEN = 4;
const MAX_ATTEMPTS_PER_WINDOW = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ATTEMPT_INTERVAL_MS = 750;
function asFourDigitPin(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^\d{4}$/.test(trimmed))
        return null;
    return trimmed;
}
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function vendorDisplayName(vendor) {
    return vendor.name ?? vendor.vendorName ?? "Vendor";
}
function hashPin(pin, salt) {
    return (0, crypto_1.scryptSync)(pin, salt, 32).toString("hex");
}
function pinMatches(vendor, pin) {
    if (typeof vendor.pinCode === "string" && vendor.pinCode.length > 0) {
        return vendor.pinCode === pin;
    }
    if (typeof vendor.pinHash === "string" && vendor.pinHash.includes(":")) {
        const [salt, expected] = vendor.pinHash.split(":");
        if (!salt || !expected)
            return false;
        const actual = hashPin(pin, salt);
        try {
            return (0, crypto_1.timingSafeEqual)(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
        }
        catch {
            return false;
        }
    }
    return false;
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
async function checkRateLimit(deliveryId) {
    const ref = getDb().collection("vendorPinAttempts").doc(deliveryId);
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
async function clearRateLimitOnSuccess(deliveryId) {
    await getDb().collection("vendorPinAttempts").doc(deliveryId).delete();
}
async function writePinVerifiedAudit(deliveryId, vendorId, vendorName) {
    const now = new Date().toISOString();
    const eventId = `pin-${(0, crypto_1.createHash)("sha256")
        .update(`${deliveryId}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb().collection("pinVerificationEvents").doc(eventId).set({
        id: eventId,
        deliveryOrderId: deliveryId,
        vendorId,
        vendorName,
        pinVerified: true,
        action: "PIN_VERIFIED",
        timestamp: now,
        createdAt: now,
    });
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
    const pin = asFourDigitPin(data.pin);
    const deliveryId = await resolveDeliveryId(asDeliveryId(data.deliveryId), asDeliveryId(data.orderId));
    if (!pin || !deliveryId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const deliverySnap = await getDb()
        .collection("deliveries")
        .doc(deliveryId)
        .get();
    if (!deliverySnap.exists) {
        return { success: false, message: "Invalid code." };
    }
    const delivery = deliverySnap.data();
    const vendorSnap = await getDb()
        .collection("vendors")
        .doc(delivery.vendorId)
        .get();
    if (!vendorSnap.exists) {
        return { success: false, message: "Invalid code." };
    }
    const vendor = vendorSnap.data();
    if (vendor.active === false) {
        return { success: false, message: "Invalid code." };
    }
    await checkRateLimit(deliveryId);
    if (!pinMatches(vendor, pin)) {
        return { success: false, message: "Invalid code." };
    }
    const vendorId = delivery.vendorId;
    const vendorName = vendorDisplayName(vendor);
    await clearRateLimitOnSuccess(deliveryId);
    await writePinVerifiedAudit(deliveryId, vendorId, vendorName);
    return {
        success: true,
        vendorId,
        vendorName,
        deliveryId,
    };
});
//# sourceMappingURL=verifyVendorPin.js.map