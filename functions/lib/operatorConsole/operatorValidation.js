"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SPOT_ALLOWANCE = exports.FOUNDING_MONTHLY_USD = void 0;
exports.resolveClientOperationId = resolveClientOperationId;
exports.parseAddress = parseAddress;
exports.requireCompanyName = requireCompanyName;
exports.parseCustomerStatus = parseCustomerStatus;
exports.parseOperatorUserRole = parseOperatorUserRole;
exports.parseOnboardingStatus = parseOnboardingStatus;
exports.parseCreateCustomerLocationInput = parseCreateCustomerLocationInput;
exports.parseCreateCustomerUserInput = parseCreateCustomerUserInput;
const https_1 = require("firebase-functions/v2/https");
const customerModels_1 = require("./customerModels");
Object.defineProperty(exports, "DEFAULT_SPOT_ALLOWANCE", { enumerable: true, get: function () { return customerModels_1.DEFAULT_SPOT_ALLOWANCE; } });
Object.defineProperty(exports, "FOUNDING_MONTHLY_USD", { enumerable: true, get: function () { return customerModels_1.FOUNDING_MONTHLY_USD; } });
const CLIENT_OPERATION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function resolveClientOperationId(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        return "";
    }
    const trimmed = raw.trim();
    return CLIENT_OPERATION_ID_RE.test(trimmed) ? trimmed : "";
}
function parseAddress(raw, label) {
    if (!raw || typeof raw !== "object") {
        throw new https_1.HttpsError("invalid-argument", `${label} address is required.`);
    }
    const obj = raw;
    const line1 = typeof obj.line1 === "string" ? obj.line1.trim() : "";
    const city = typeof obj.city === "string" ? obj.city.trim() : "";
    const region = typeof obj.region === "string" ? obj.region.trim() : "";
    const postalCode = typeof obj.postalCode === "string" ? obj.postalCode.trim() : "";
    const country = typeof obj.country === "string" && obj.country.trim()
        ? obj.country.trim()
        : "US";
    if (!line1 || !city || !region || !postalCode) {
        throw new https_1.HttpsError("invalid-argument", `${label} address must include line1, city, region, and postalCode.`);
    }
    const line2 = typeof obj.line2 === "string" ? obj.line2.trim() : undefined;
    return { line1, line2, city, region, postalCode, country };
}
function requireCompanyName(raw) {
    if (typeof raw !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Company name is required.");
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new https_1.HttpsError("invalid-argument", "Company name is required.");
    }
    return trimmed;
}
function parseCustomerStatus(raw) {
    if (raw === "active" || raw === "inactive" || raw === "prospect") {
        return raw;
    }
    return "prospect";
}
function parseOperatorUserRole(raw) {
    const allowed = [
        "customer_admin",
        "manager",
        "dispatcher",
        "technician",
    ];
    if (typeof raw === "string" && allowed.includes(raw)) {
        return raw;
    }
    throw new https_1.HttpsError("invalid-argument", "Invalid user role.");
}
function parseOnboardingStatus(raw) {
    if (typeof raw === "string" &&
        customerModels_1.ONBOARDING_STATUSES.includes(raw)) {
        return raw;
    }
    throw new https_1.HttpsError("invalid-argument", "Invalid onboarding status.");
}
function parseCreateCustomerLocationInput(raw, index) {
    if (!raw || typeof raw !== "object") {
        throw new https_1.HttpsError("invalid-argument", `Location ${index + 1} is required.`);
    }
    const obj = raw;
    const locationName = typeof obj.locationName === "string" ? obj.locationName.trim() : "";
    const physicalAddress = parseAddress(obj.physicalAddress, `Location ${index + 1} physical`);
    const billingSameAsPhysical = obj.billingSameAsPhysical === true;
    const billingAddress = billingSameAsPhysical
        ? { ...physicalAddress }
        : parseAddress(obj.billingAddress ?? obj.physicalAddress, `Location ${index + 1} billing`);
    const groundSpotCount = typeof obj.groundSpotCount === "number" && Number.isFinite(obj.groundSpotCount)
        ? Math.max(0, Math.floor(obj.groundSpotCount))
        : 0;
    const shelfSpotCount = typeof obj.shelfSpotCount === "number" && Number.isFinite(obj.shelfSpotCount)
        ? Math.max(0, Math.floor(obj.shelfSpotCount))
        : 0;
    if (groundSpotCount + shelfSpotCount <= 0) {
        throw new https_1.HttpsError("invalid-argument", `Location ${index + 1} must include at least one spot.`);
    }
    return {
        locationName: locationName || "Unnamed location",
        physicalAddress,
        billingAddress,
        billingSameAsPhysical,
        billingContactName: typeof obj.billingContactName === "string"
            ? obj.billingContactName.trim()
            : "",
        billingEmail: typeof obj.billingEmail === "string" ? obj.billingEmail.trim() : "",
        billingPhone: typeof obj.billingPhone === "string" ? obj.billingPhone.trim() : "",
        groundSpotCount,
        shelfSpotCount,
        spotAllowance: customerModels_1.DEFAULT_SPOT_ALLOWANCE,
    };
}
function parseCreateCustomerUserInput(raw, index) {
    if (!raw || typeof raw !== "object") {
        throw new https_1.HttpsError("invalid-argument", `User ${index + 1} is invalid.`);
    }
    const obj = raw;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    const email = typeof obj.email === "string" ? obj.email.trim() : "";
    if (!name || !email) {
        throw new https_1.HttpsError("invalid-argument", `User ${index + 1} requires name and email.`);
    }
    const role = parseOperatorUserRole(obj.role);
    const locationIndexes = Array.isArray(obj.locationIndexes)
        ? obj.locationIndexes
            .filter((v) => typeof v === "number" && Number.isInteger(v))
            .map((v) => Math.max(0, v))
        : undefined;
    const locationIds = Array.isArray(obj.locationIds)
        ? obj.locationIds.filter((v) => typeof v === "string")
        : undefined;
    return { name, email, role, locationIndexes, locationIds };
}
//# sourceMappingURL=operatorValidation.js.map