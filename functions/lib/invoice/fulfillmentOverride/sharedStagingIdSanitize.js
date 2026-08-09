"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PLANNED_STAGING_IDS = void 0;
exports.sanitizePlannedStagingLocationIds = sanitizePlannedStagingLocationIds;
/** Shared staging id sanitize — approve + draft staging override paths. */
exports.MAX_PLANNED_STAGING_IDS = 20;
function sanitizePlannedStagingLocationIds(raw) {
    if (!Array.isArray(raw))
        return [];
    return [
        ...new Set(raw
            .filter((id) => typeof id === "string")
            .map((id) => id.trim())
            .filter((id) => id.length > 0 && id.length <= 128)),
    ].slice(0, exports.MAX_PLANNED_STAGING_IDS);
}
//# sourceMappingURL=sharedStagingIdSanitize.js.map