"use strict";
/** Public-safe material issue snapshot on delivery — pickup portal readback only. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendPickupMaterialIssueReadback = appendPickupMaterialIssueReadback;
exports.resolvePickupMaterialIssueReadback = resolvePickupMaterialIssueReadback;
function appendPickupMaterialIssueReadback(existing, entry) {
    return [...(existing ?? []), entry];
}
function resolvePickupMaterialIssueReadback(existing, issueId, resolution) {
    return (existing ?? []).map((row) => row.id === issueId
        ? {
            ...row,
            status: "resolved",
            resolutionType: resolution.resolutionType,
            resolutionNote: resolution.resolutionNote,
            resolvedAt: resolution.resolvedAt,
        }
        : row);
}
//# sourceMappingURL=pickupMaterialIssueReadback.js.map