"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MANAGEMENT_SESSION_MINUTES = exports.DEFAULT_VENDOR_SESSION_MINUTES = exports.DEFAULT_TECHNICIAN_SESSION_MINUTES = exports.MIN_ATTEMPT_INTERVAL_MS = exports.ATTEMPT_WINDOW_MS = exports.MAX_ATTEMPTS_PER_WINDOW = exports.asAccessPin = void 0;
exports.asStagingLocationCode = asStagingLocationCode;
exports.resolveStagingLocation = resolveStagingLocation;
exports.checkPinRateLimit = checkPinRateLimit;
exports.clearPinRateLimit = clearPinRateLimit;
exports.getTechnicianSessionMinutes = getTechnicianSessionMinutes;
exports.getVendorSessionMinutes = getVendorSessionMinutes;
exports.getManagementSessionMinutes = getManagementSessionMinutes;
exports.vendorDisplayName = vendorDisplayName;
exports.findTechnicianByPin = findTechnicianByPin;
exports.findJobByPin = findJobByPin;
exports.jobPinMatchExistsInTransaction = jobPinMatchExistsInTransaction;
exports.findVendorByCompanyPin = findVendorByCompanyPin;
exports.anchorDeliveryForVendor = anchorDeliveryForVendor;
exports.primaryVendorForJob = primaryVendorForJob;
exports.createVendorSession = createVendorSession;
exports.writeVendorPinVerifiedAudit = writeVendorPinVerifiedAudit;
exports.mintTechnicianSession = mintTechnicianSession;
exports.mintManagementSession = mintManagementSession;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const accessPinLookup_1 = require("./accessPinLookup");
const pinMatching_1 = require("./pinMatching");
Object.defineProperty(exports, "asAccessPin", { enumerable: true, get: function () { return pinMatching_1.asAccessPin; } });
function getDb() {
    return admin.firestore();
}
exports.MAX_ATTEMPTS_PER_WINDOW = 8;
exports.ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
exports.MIN_ATTEMPT_INTERVAL_MS = 750;
exports.DEFAULT_TECHNICIAN_SESSION_MINUTES = 15;
exports.DEFAULT_VENDOR_SESSION_MINUTES = 15;
exports.DEFAULT_MANAGEMENT_SESSION_MINUTES = 30;
function asStagingLocationCode(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32)
        return null;
    return trimmed;
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
async function checkPinRateLimit(collectionName, attemptKey) {
    const ref = getDb().collection(collectionName).doc(attemptKey);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {});
        const windowStart = data.windowStartedAt
            ? Date.parse(data.windowStartedAt)
            : now;
        const inWindow = now - windowStart < exports.ATTEMPT_WINDOW_MS;
        const count = inWindow ? (data.count ?? 0) : 0;
        if (inWindow && count >= exports.MAX_ATTEMPTS_PER_WINDOW) {
            throw new https_1.HttpsError("resource-exhausted", "Too many attempts. Try again later.");
        }
        const lastAttempt = data.lastAttemptAt
            ? Date.parse(data.lastAttemptAt)
            : 0;
        if (lastAttempt && now - lastAttempt < exports.MIN_ATTEMPT_INTERVAL_MS) {
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
async function clearPinRateLimit(collectionName, attemptKey) {
    await getDb().collection(collectionName).doc(attemptKey).delete();
}
async function getTechnicianSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return exports.DEFAULT_TECHNICIAN_SESSION_MINUTES;
    const minutes = snap.data()
        .technicianSessionMinutes;
    if (typeof minutes === "number" &&
        Number.isFinite(minutes) &&
        minutes >= 5 &&
        minutes <= 480) {
        return minutes;
    }
    return exports.DEFAULT_TECHNICIAN_SESSION_MINUTES;
}
async function getVendorSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return exports.DEFAULT_VENDOR_SESSION_MINUTES;
    const minutes = snap.data()
        .vendorSessionMinutes;
    if (typeof minutes === "number" &&
        Number.isFinite(minutes) &&
        minutes >= 5 &&
        minutes <= 480) {
        return minutes;
    }
    return exports.DEFAULT_VENDOR_SESSION_MINUTES;
}
async function getManagementSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return exports.DEFAULT_MANAGEMENT_SESSION_MINUTES;
    const minutes = snap.data()
        .managementSessionMinutes;
    if (typeof minutes === "number" &&
        Number.isFinite(minutes) &&
        minutes >= 5 &&
        minutes <= 480) {
        return minutes;
    }
    return exports.DEFAULT_MANAGEMENT_SESSION_MINUTES;
}
function vendorDisplayName(vendor) {
    return vendor.name ?? vendor.vendorName ?? "Vendor";
}
async function findTechnicianByPin(pin) {
    const fromSecrets = await (0, accessPinLookup_1.findTechnicianByAccessPinSecrets)(pin);
    if (fromSecrets)
        return fromSecrets;
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
async function findJobByPin(pin) {
    const db = getDb();
    const pinCodeSnap = await db
        .collection("jobs")
        .where("pinCode", "==", pin)
        .limit(2)
        .get();
    if (pinCodeSnap.size === 1) {
        return {
            id: pinCodeSnap.docs[0].id,
            data: pinCodeSnap.docs[0].data(),
        };
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
/**
 * Transaction-safe check: does any job's pinCode/pinHash match this PIN?
 * Used by the access-PIN uniqueness write path so a newly set
 * technician/vendor/management PIN cannot collide with a job PIN.
 * Matching semantics mirror findJobByPin (no status filter).
 */
async function jobPinMatchExistsInTransaction(tx, pin) {
    const db = getDb();
    const pinCodeSnap = await tx.get(db.collection("jobs").where("pinCode", "==", pin).limit(1));
    if (!pinCodeSnap.empty)
        return true;
    const allJobsSnap = await tx.get(db.collection("jobs").limit(500));
    for (const doc of allJobsSnap.docs) {
        const job = doc.data();
        if ((0, pinMatching_1.pinMatches)(job, pin))
            return true;
    }
    return false;
}
async function findVendorByCompanyPin(pin) {
    const fromSecrets = await (0, accessPinLookup_1.findVendorByAccessPinSecrets)(pin);
    if (fromSecrets)
        return fromSecrets;
    const db = getDb();
    const pinCodeSnap = await db
        .collection("vendors")
        .where("pinCode", "==", pin)
        .where("companyWideSessionEnabled", "==", true)
        .limit(2)
        .get();
    const candidates = [];
    for (const doc of pinCodeSnap.docs) {
        const vendor = doc.data();
        if (vendor.active === false)
            continue;
        candidates.push({ id: doc.id, data: vendor });
    }
    if (candidates.length === 1) {
        return candidates[0];
    }
    if (candidates.length > 1)
        return null;
    const allVendors = await db
        .collection("vendors")
        .where("companyWideSessionEnabled", "==", true)
        .limit(200)
        .get();
    for (const doc of allVendors.docs) {
        const vendor = doc.data();
        if (vendor.active === false)
            continue;
        if ((0, pinMatching_1.pinMatches)(vendor, pin)) {
            return { id: doc.id, data: vendor };
        }
    }
    return null;
}
async function anchorDeliveryForVendor(vendorId) {
    const snap = await getDb()
        .collection("deliveries")
        .where("vendorId", "==", vendorId)
        .limit(20)
        .get();
    if (snap.empty)
        return null;
    return snap.docs[0].id;
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
        ...(input.unplannedEligible ? { unplannedEligible: true } : {}),
    });
    return { sessionToken, expiresAt };
}
async function writeVendorPinVerifiedAudit(input) {
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
async function mintTechnicianSession(input) {
    const sessionMinutes = await getTechnicianSessionMinutes();
    const now = Date.now();
    const expiresAt = new Date(now + sessionMinutes * 60 * 1000).toISOString();
    const sessionToken = (0, crypto_1.randomBytes)(32).toString("hex");
    const scannedStagingLocationCode = input.resolvedLocation?.code ?? input.stagingLocationCode;
    await getDb().collection("technicianSessions").doc(sessionToken).set({
        id: sessionToken,
        technicianId: input.technicianId,
        technicianName: input.technicianName,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        scannedStagingLocationCode,
    });
    const eventId = `tech-pin-${(0, crypto_1.createHash)("sha256")
        .update(`${input.technicianId}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb().collection("pinVerificationEvents").doc(eventId).set({
        id: eventId,
        technicianId: input.technicianId,
        technicianName: input.technicianName,
        pinVerified: true,
        action: "TECH_PIN_VERIFIED",
        timestamp: new Date(now).toISOString(),
        createdAt: new Date(now).toISOString(),
        stagingLocationCode: scannedStagingLocationCode,
    });
    return { sessionToken, expiresAt, scannedStagingLocationCode };
}
async function mintManagementSession(input) {
    const sessionMinutes = await getManagementSessionMinutes();
    const now = Date.now();
    const expiresAt = new Date(now + sessionMinutes * 60 * 1000).toISOString();
    const sessionToken = (0, crypto_1.randomBytes)(32).toString("hex");
    await getDb().collection("managementSessions").doc(sessionToken).set({
        id: sessionToken,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        scannedStagingLocationCode: input.location.code,
        scannedStagingLocationId: input.location.id,
        pinId: input.pinId,
        permissions: input.permissions,
    });
    const eventId = `mgmt-pin-${(0, crypto_1.createHash)("sha256")
        .update(`${input.location.id}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb().collection("pinVerificationEvents").doc(eventId).set({
        id: eventId,
        pinVerified: true,
        action: "MANAGEMENT_PIN_VERIFIED",
        timestamp: new Date(now).toISOString(),
        createdAt: new Date(now).toISOString(),
        stagingLocationCode: input.location.code,
        pinId: input.pinId,
    });
    return {
        sessionToken,
        expiresAt,
        scannedStagingLocationCode: input.location.code,
    };
}
//# sourceMappingURL=locationScanPinShared.js.map