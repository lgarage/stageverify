"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeIngestErrorMessage = sanitizeIngestErrorMessage;
exports.shouldPersistTokenExpired = shouldPersistTokenExpired;
exports.evaluateGmailIngestHealth = evaluateGmailIngestHealth;
const DEFAULT_STALE_AFTER_HOURS = 2;
const MS_PER_HOUR = 60 * 60 * 1000;
function parseIsoMs(iso) {
    if (!iso)
        return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}
function sanitizeIngestErrorMessage(raw) {
    let out = raw;
    out = out.replace(/refresh_token\s*=\s*[^\s&"']+/gi, "[refresh_token redacted]");
    out = out.replace(/access_token\s*=\s*[^\s&"']+/gi, "[access_token redacted]");
    out = out.replace(/client_secret\s*=\s*[^\s&"']+/gi, "[client_secret redacted]");
    out = out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]");
    out = out.replace(/\bya29\.[A-Za-z0-9._\-+/=]+/gi, "[token redacted]");
    if (out.length > 300) {
        out = out.slice(0, 297) + "...";
    }
    return out;
}
function shouldPersistTokenExpired(refreshErrorMessage) {
    return /token refresh failed: (400|401)\b/.test(refreshErrorMessage);
}
function evaluateGmailIngestHealth(input, nowMs) {
    const { connectionStatus, connectedAt, ingestHealth } = input;
    if (connectionStatus === "disconnected") {
        return { healthy: true };
    }
    if (connectionStatus === "token_expired") {
        return { healthy: false, unhealthyReason: "token_expired" };
    }
    if (connectionStatus === "connected") {
        if (ingestHealth?.tokenRefreshFailed) {
            return { healthy: false, unhealthyReason: "token_refresh_failed" };
        }
        const staleAfterHours = ingestHealth?.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;
        const referenceIso = ingestHealth?.lastSuccessfulSyncAt ?? connectedAt;
        const referenceMs = parseIsoMs(referenceIso);
        if (referenceMs === null) {
            return { healthy: true };
        }
        const staleMs = staleAfterHours * MS_PER_HOUR;
        if (nowMs - referenceMs > staleMs) {
            return { healthy: false, unhealthyReason: "stale_no_sync" };
        }
        return { healthy: true };
    }
    return { healthy: true };
}
//# sourceMappingURL=gmailIngestHealth.js.map