"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDispatcherAccessRole = exports.managerFlagForRole = void 0;
exports.validateHumanFullName = validateHumanFullName;
exports.parseDispatcherAccessRole = parseDispatcherAccessRole;
exports.countActiveAdmins = countActiveAdmins;
exports.assertNotLastActiveAdmin = assertNotLastActiveAdmin;
exports.rolePatch = rolePatch;
/**
 * Shared validation + Admin roster helpers for Auth human identities.
 */
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
Object.defineProperty(exports, "managerFlagForRole", { enumerable: true, get: function () { return dispatcherAuth_1.managerFlagForRole; } });
Object.defineProperty(exports, "resolveDispatcherAccessRole", { enumerable: true, get: function () { return dispatcherAuth_1.resolveDispatcherAccessRole; } });
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";
const VAGUE_FULL_NAMES = new Set([
    "dan",
    "test",
    "user",
    "admin",
    "manager",
    "dispatcher",
    "technician",
    "manager pin",
    "management pin",
    "management",
].map((s) => s.toLowerCase()));
/** Meaningful full name for new human Auth users — first + last token required. */
function validateHumanFullName(raw) {
    if (typeof raw !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Full name is required.");
    }
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (trimmed.length < 3 || trimmed.length > 80) {
        throw new https_1.HttpsError("invalid-argument", "Enter a full name (first and last).");
    }
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(trimmed)) {
        throw new https_1.HttpsError("invalid-argument", "Full name may only contain letters, spaces, hyphens, apostrophes, or periods.");
    }
    const parts = trimmed.split(" ").filter(Boolean);
    if (parts.length < 2) {
        throw new https_1.HttpsError("invalid-argument", "Enter a full name (first and last).");
    }
    if (VAGUE_FULL_NAMES.has(trimmed.toLowerCase())) {
        throw new https_1.HttpsError("invalid-argument", "Enter a real named identity (not a role or test label).");
    }
    return trimmed;
}
function parseDispatcherAccessRole(raw) {
    if (raw === "admin" || raw === "manager" || raw === "dispatcher") {
        return raw;
    }
    return null;
}
async function countActiveAdmins(excludeUid) {
    const snap = await (0, accessPinSecretsShared_1.getDb)().collection(DISPATCHER_ROLES_COLLECTION).get();
    let count = 0;
    for (const doc of snap.docs) {
        if (excludeUid && doc.id === excludeUid)
            continue;
        const data = doc.data();
        if (data.removed === true)
            continue;
        if (data.active === false)
            continue;
        if ((0, dispatcherAuth_1.resolveDispatcherAccessRole)(data) === "admin")
            count += 1;
    }
    return count;
}
/** Fail closed if demoting/deactivating would leave zero active Admins. */
async function assertNotLastActiveAdmin(targetUid, targetData) {
    if ((0, dispatcherAuth_1.resolveDispatcherAccessRole)(targetData) !== "admin")
        return;
    if (targetData.active === false || targetData.removed === true)
        return;
    const remaining = await countActiveAdmins(targetUid);
    if (remaining < 1) {
        throw new https_1.HttpsError("failed-precondition", "Cannot remove or demote the last active Admin.");
    }
}
function rolePatch(role, extra = {}) {
    return {
        role,
        manager: (0, dispatcherAuth_1.managerFlagForRole)(role),
        ...extra,
    };
}
//# sourceMappingURL=humanAccessIdentity.js.map