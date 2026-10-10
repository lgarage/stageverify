"use strict";
/** Pure helpers for scheduled Gmail inbound catch-up (no I/O). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIST_CAP = exports.PROCESS_CAP = exports.DEFAULT_LOOKBACK_SECONDS = exports.OVERLAP_SECONDS = void 0;
exports.isGmailListingComplete = isGmailListingComplete;
exports.buildInboxCatchUpQuery = buildInboxCatchUpQuery;
exports.oldestFirstInboxIds = oldestFirstInboxIds;
exports.uniquePreserveOrder = uniquePreserveOrder;
exports.applyCatchUpCap = applyCatchUpCap;
exports.shouldAdvanceInboundSyncCursor = shouldAdvanceInboundSyncCursor;
exports.OVERLAP_SECONDS = 2 * 60 * 60;
exports.DEFAULT_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
/** Max messages processed per catch-up sync pass (history + after: union). */
exports.PROCESS_CAP = 40;
/** Max inbox/history ids listed per pass before cursor advance is blocked. */
exports.LIST_CAP = 500;
function isGmailListingComplete(options) {
    if (options.listedCount >= options.listCap && options.nextPageToken)
        return false;
    if (options.emptyPage)
        return !options.nextPageToken;
    return !options.nextPageToken;
}
function buildInboxCatchUpQuery(options) {
    const { lastSyncAt, replyEnabled, nowMs } = options;
    let unixSeconds;
    if (lastSyncAt) {
        const parsed = Date.parse(lastSyncAt);
        if (!Number.isNaN(parsed)) {
            unixSeconds = Math.floor((parsed - exports.OVERLAP_SECONDS * 1000) / 1000);
        }
        else {
            unixSeconds = Math.floor((nowMs - exports.DEFAULT_LOOKBACK_SECONDS * 1000) / 1000);
        }
    }
    else {
        unixSeconds = Math.floor((nowMs - exports.DEFAULT_LOOKBACK_SECONDS * 1000) / 1000);
    }
    const inboxClause = replyEnabled
        ? "in:inbox (has:attachment filename:pdf OR -has:attachment)"
        : "has:attachment filename:pdf in:inbox";
    return `after:${unixSeconds} ${inboxClause}`;
}
/** Gmail messages.list is newest-first; catch-up should process oldest-first. */
function oldestFirstInboxIds(newestFirstIds) {
    return [...newestFirstIds].reverse();
}
function uniquePreserveOrder(ids) {
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
        if (seen.has(id))
            continue;
        seen.add(id);
        unique.push(id);
    }
    return unique;
}
function applyCatchUpCap(options) {
    const { listedIds, cap } = options;
    const unique = uniquePreserveOrder(listedIds);
    const processNow = unique.slice(0, cap);
    const remainderCount = Math.max(0, unique.length - cap);
    return { processNow, remainderCount };
}
function shouldAdvanceInboundSyncCursor(options) {
    return options.listingComplete === true && options.remainderCount === 0;
}
//# sourceMappingURL=gmailInboundCatchUp.js.map