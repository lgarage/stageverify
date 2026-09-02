"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONBOARDING_FORWARD_ORDER = void 0;
exports.canTransitionOnboarding = canTransitionOnboarding;
exports.listAllowedOnboardingTransitions = listAllowedOnboardingTransitions;
exports.transitionOnboarding = transitionOnboarding;
exports.rollupCustomerOnboarding = rollupCustomerOnboarding;
const FORWARD_CHAIN = [
    "NEW",
    "CONFIGURING",
    "LAYOUT_DRAFT",
    "LAYOUT_APPROVED",
    "SIGNS_ORDERED",
    "READY_TO_INSTALL",
    "INSTALLING",
    "ACTIVE",
];
const ALLOWED = new Map([
    ["NEW", ["CONFIGURING"]],
    ["CONFIGURING", ["LAYOUT_DRAFT"]],
    ["LAYOUT_DRAFT", ["LAYOUT_APPROVED"]],
    ["LAYOUT_APPROVED", ["SIGNS_ORDERED"]],
    ["SIGNS_ORDERED", ["READY_TO_INSTALL"]],
    ["READY_TO_INSTALL", ["INSTALLING"]],
    ["INSTALLING", ["ACTIVE"]],
    ["ACTIVE", ["PAST_DUE", "SUSPENDED", "CANCELED"]],
    ["PAST_DUE", ["ACTIVE", "SUSPENDED", "CANCELED"]],
    ["SUSPENDED", ["ACTIVE", "CANCELED"]],
    ["CANCELED", []],
]);
function canTransitionOnboarding(from, to) {
    if (from === to)
        return false;
    const allowed = ALLOWED.get(from);
    return allowed?.includes(to) ?? false;
}
function listAllowedOnboardingTransitions(from) {
    return [...(ALLOWED.get(from) ?? [])];
}
function transitionOnboarding(location, to, nowIso) {
    const from = location.onboardingStatus;
    if (!canTransitionOnboarding(from, to)) {
        throw new Error(`Illegal onboarding transition ${from} → ${to} for location ${location.locationId}`);
    }
    const next = {
        ...location,
        onboardingStatus: to,
        updatedAt: nowIso,
    };
    if (to === "ACTIVE") {
        if (!next.activationDate) {
            next.activationDate = nowIso;
        }
        next.locationStatus = "active";
    }
    else if (to === "SUSPENDED") {
        next.locationStatus = "suspended";
    }
    else if (to === "CANCELED") {
        next.locationStatus = "canceled";
    }
    else if (to === "PAST_DUE") {
        next.locationStatus = "active";
    }
    return next;
}
exports.ONBOARDING_FORWARD_ORDER = FORWARD_CHAIN;
const SETTLED_STATUSES = [
    "ACTIVE",
    "CANCELED",
    "SUSPENDED",
    "PAST_DUE",
];
/** Customer list rollup — least-advanced in-progress location wins. */
function rollupCustomerOnboarding(locations) {
    if (locations.length === 0)
        return "NEW";
    const inProgress = locations.filter((loc) => !SETTLED_STATUSES.includes(loc.onboardingStatus));
    if (inProgress.length > 0) {
        let minIndex = Number.POSITIVE_INFINITY;
        let rollup = "NEW";
        for (const loc of inProgress) {
            const idx = FORWARD_CHAIN.indexOf(loc.onboardingStatus);
            if (idx !== -1 && idx < minIndex) {
                minIndex = idx;
                rollup = loc.onboardingStatus;
            }
        }
        return rollup;
    }
    if (locations.some((loc) => loc.onboardingStatus === "PAST_DUE")) {
        return "PAST_DUE";
    }
    if (locations.some((loc) => loc.onboardingStatus === "SUSPENDED")) {
        return "SUSPENDED";
    }
    if (locations.every((loc) => loc.onboardingStatus === "CANCELED")) {
        return "CANCELED";
    }
    return "ACTIVE";
}
//# sourceMappingURL=onboardingTransitions.js.map