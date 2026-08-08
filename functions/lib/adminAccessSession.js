"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_ACCESS_SESSION_TTL_MS = void 0;
exports.hashAdminAccessSessionRaw = hashAdminAccessSessionRaw;
exports.parseAdminAccessSessionToken = parseAdminAccessSessionToken;
exports.formatAdminAccessSessionToken = formatAdminAccessSessionToken;
exports.createAdminAccessSession = createAdminAccessSession;
exports.validateAdminAccessSession = validateAdminAccessSession;
exports.revokeAdminAccessSessionByToken = revokeAdminAccessSessionByToken;
exports.consumeAdminAccessSessionByToken = consumeAdminAccessSessionByToken;
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
exports.ADMIN_ACCESS_SESSION_TTL_MS = 5 * 60 * 1000;
function hashAdminAccessSessionRaw(raw) {
    return (0, crypto_1.createHash)("sha256").update(raw, "utf8").digest("hex");
}
/** Token format: `{sessionId}.{raw}` — 16-byte hex id + 32-byte hex raw. */
function parseAdminAccessSessionToken(token) {
    const trimmed = token.trim();
    const dot = trimmed.indexOf(".");
    if (dot <= 0 || dot >= trimmed.length - 1)
        return null;
    const sessionId = trimmed.slice(0, dot);
    const raw = trimmed.slice(dot + 1);
    if (!/^[0-9a-f]{32}$/.test(sessionId))
        return null;
    if (!/^[0-9a-f]{64}$/.test(raw))
        return null;
    return { sessionId, raw };
}
function formatAdminAccessSessionToken(sessionId, raw) {
    return `${sessionId}.${raw}`;
}
async function createAdminAccessSession(input) {
    const sessionId = (0, crypto_1.randomBytes)(16).toString("hex");
    const raw = (0, crypto_1.randomBytes)(32).toString("hex");
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + exports.ADMIN_ACCESS_SESSION_TTL_MS).toISOString();
    const doc = {
        managerUid: input.managerUid,
        targetType: input.targetType,
        targetId: input.targetId,
        secretHash: hashAdminAccessSessionRaw(raw),
        createdAt,
        expiresAt,
        revoked: false,
    };
    await (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
        .doc(sessionId)
        .set(doc);
    return {
        sessionToken: formatAdminAccessSessionToken(sessionId, raw),
        expiresAt,
    };
}
async function validateAdminAccessSession(input) {
    const parsed = parseAdminAccessSessionToken(input.sessionToken);
    if (!parsed) {
        return { ok: false, reason: "invalid_token" };
    }
    const snap = await (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
        .doc(parsed.sessionId)
        .get();
    if (!snap.exists) {
        return { ok: false, reason: "not_found" };
    }
    const session = snap.data();
    if (session.secretHash !== hashAdminAccessSessionRaw(parsed.raw)) {
        return { ok: false, reason: "invalid_token" };
    }
    if (session.revoked) {
        return { ok: false, reason: "revoked" };
    }
    if (session.consumedAt) {
        return { ok: false, reason: "consumed" };
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
        return { ok: false, reason: "expired" };
    }
    if (session.managerUid !== input.managerUid) {
        return { ok: false, reason: "uid_mismatch" };
    }
    if (session.targetType !== input.targetType ||
        session.targetId !== input.targetId) {
        return { ok: false, reason: "target_mismatch" };
    }
    return { ok: true, sessionId: parsed.sessionId };
}
/** Idempotent revoke — returns true when session transitioned to revoked. */
async function revokeAdminAccessSessionByToken(sessionToken) {
    const parsed = parseAdminAccessSessionToken(sessionToken);
    if (!parsed)
        return false;
    const ref = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
        .doc(parsed.sessionId);
    let didRevoke = false;
    await (0, accessPinSecretsShared_1.getDb)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            return;
        const session = snap.data();
        if (session.secretHash !== hashAdminAccessSessionRaw(parsed.raw))
            return;
        if (session.revoked || session.consumedAt)
            return;
        tx.set(ref, {
            revoked: true,
        }, { merge: true });
        didRevoke = true;
    });
    return didRevoke;
}
/** Mark session consumed after successful elevated PIN write. */
async function consumeAdminAccessSessionByToken(sessionToken) {
    const parsed = parseAdminAccessSessionToken(sessionToken);
    if (!parsed) {
        throw new https_1.HttpsError("invalid-argument", "Invalid admin access session.");
    }
    const ref = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
        .doc(parsed.sessionId);
    const consumedAt = new Date().toISOString();
    await (0, accessPinSecretsShared_1.getDb)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
        }
        const session = snap.data();
        if (session.secretHash !== hashAdminAccessSessionRaw(parsed.raw)) {
            throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
        }
        if (session.revoked || session.consumedAt) {
            throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
        }
        if (Date.parse(session.expiresAt) <= Date.now()) {
            throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
        }
        tx.set(ref, { consumedAt }, { merge: true });
    });
}
//# sourceMappingURL=adminAccessSession.js.map