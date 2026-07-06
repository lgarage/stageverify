"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGmailAccessTokenForProvider = getGmailAccessTokenForProvider;
exports.parseEmailAddress = parseEmailAddress;
exports.parseGmailHeaders = parseGmailHeaders;
exports.extractGmailBodyText = extractGmailBodyText;
exports.findPdfAttachments = findPdfAttachments;
exports.fetchGmailMessage = fetchGmailMessage;
exports.downloadGmailAttachment = downloadGmailAttachment;
exports.listRecentInboxMessageIds = listRecentInboxMessageIds;
exports.listGmailHistory = listGmailHistory;
exports.getGmailProfile = getGmailProfile;
exports.parseGmailPushNotification = parseGmailPushNotification;
exports.registerGmailWatch = registerGmailWatch;
exports.gmailOAuthSecretsConfigured = gmailOAuthSecretsConfigured;
exports.decodeGmailBodyData = decodeGmailBodyData;
/**
 * Gmail inbound fetch helpers — read-only sync for invoice PDF ingestion.
 * Server-side only; never log tokens or attachment bytes.
 */
const gmailApi_1 = require("./gmailApi");
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
function gmailHeadersInit(accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
}
async function gmailJson(accessToken, path) {
    const res = await fetch(`${GMAIL_BASE}${path}`, {
        headers: gmailHeadersInit(accessToken),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`gmail api ${path}: ${res.status}`);
    }
    return JSON.parse(text);
}
async function getGmailAccessTokenForProvider(refreshToken) {
    return (0, gmailApi_1.refreshGmailAccessToken)(refreshToken);
}
function parseEmailAddress(raw) {
    const trimmed = raw.trim();
    const angle = trimmed.match(/<([^>]+)>/);
    if (angle?.[1])
        return angle[1].trim().toLowerCase();
    if (trimmed.includes("@"))
        return trimmed.toLowerCase();
    return trimmed.toLowerCase();
}
function splitAddressList(raw) {
    return raw
        .split(",")
        .map((part) => parseEmailAddress(part))
        .filter(Boolean);
}
function parseReferencesHeader(raw) {
    return raw
        .split(/\s+/)
        .map((id) => id.trim())
        .filter(Boolean);
}
function parseGmailHeaders(headers) {
    try {
        const map = new Map();
        for (const h of headers ?? []) {
            if (h.name && h.value)
                map.set(h.name.toLowerCase(), h.value);
        }
        const fromRaw = map.get("from") ?? "";
        const subject = (map.get("subject") ?? "").trim();
        const dateRaw = map.get("date") ?? "";
        let receivedAt = new Date().toISOString();
        if (dateRaw) {
            const parsed = Date.parse(dateRaw);
            if (!Number.isNaN(parsed))
                receivedAt = new Date(parsed).toISOString();
        }
        const referencesRaw = map.get("references") ?? "";
        return {
            senderEmail: parseEmailAddress(fromRaw),
            subject,
            receivedAt,
            messageIdHeader: map.get("message-id")?.trim(),
            inReplyTo: map.get("in-reply-to")?.trim(),
            references: referencesRaw ? parseReferencesHeader(referencesRaw) : undefined,
            toAddresses: map.get("to") ? splitAddressList(map.get("to")) : undefined,
            ccAddresses: map.get("cc") ? splitAddressList(map.get("cc")) : undefined,
            deliveredTo: map.get("delivered-to")
                ? splitAddressList(map.get("delivered-to"))
                : undefined,
            authenticationResults: map.get("authentication-results")?.trim(),
            autoSubmitted: map.get("auto-submitted")?.trim(),
            precedence: map.get("precedence")?.trim(),
        };
    }
    catch {
        const map = new Map();
        for (const h of headers ?? []) {
            if (h.name && h.value)
                map.set(h.name.toLowerCase(), h.value);
        }
        const fromRaw = map.get("from") ?? "";
        const subject = (map.get("subject") ?? "").trim();
        const dateRaw = map.get("date") ?? "";
        let receivedAt = new Date().toISOString();
        if (dateRaw) {
            const parsed = Date.parse(dateRaw);
            if (!Number.isNaN(parsed))
                receivedAt = new Date(parsed).toISOString();
        }
        return {
            senderEmail: parseEmailAddress(fromRaw),
            subject,
            receivedAt,
        };
    }
}
/** Extract plain-text body from a Gmail message payload (best-effort). */
function extractGmailBodyText(payload, maxLen = 12_000) {
    if (!payload)
        return "";
    const parts = [];
    const walk = (part) => {
        const mime = (part.mimeType ?? "").toLowerCase();
        if (part.parts?.length) {
            for (const child of part.parts)
                walk(child);
            return;
        }
        if (mime === "text/plain" && part.body?.data) {
            parts.push(decodeGmailBodyData(part.body.data));
        }
    };
    walk(payload);
    const combined = parts.join("\n").trim();
    if (combined.length <= maxLen)
        return combined;
    return `${combined.slice(0, maxLen - 1)}…`;
}
function isPdfPart(part) {
    const mime = (part.mimeType ?? "").toLowerCase();
    const name = (part.filename ?? "").toLowerCase();
    return mime === "application/pdf" || name.endsWith(".pdf");
}
/** Recursively collect PDF attachment metadata from a Gmail message payload. */
function findPdfAttachments(payload) {
    const out = [];
    if (!payload)
        return out;
    const walk = (part) => {
        if (part.parts?.length) {
            for (const child of part.parts)
                walk(child);
            return;
        }
        if (!isPdfPart(part))
            return;
        const attachmentId = part.body?.attachmentId;
        if (!attachmentId)
            return;
        out.push({
            filename: part.filename?.trim() || "attachment.pdf",
            mimeType: part.mimeType ?? "application/pdf",
            attachmentId,
            sizeBytes: part.body?.size ?? 0,
        });
    };
    walk(payload);
    return out;
}
async function fetchGmailMessage(accessToken, messageId) {
    return gmailJson(accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`);
}
async function downloadGmailAttachment(accessToken, messageId, attachmentId) {
    const data = await gmailJson(accessToken, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    if (!data.data) {
        throw new Error("attachment missing data");
    }
    const normalized = data.data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64");
}
async function listRecentInboxMessageIds(accessToken, options) {
    const maxResults = options?.maxResults ?? 25;
    const query = options?.query ?? "has:attachment filename:pdf in:inbox";
    const params = new URLSearchParams({
        maxResults: String(maxResults),
        q: query,
    });
    const listed = await gmailJson(accessToken, `/messages?${params.toString()}`);
    return listed.messages ?? [];
}
async function listGmailHistory(accessToken, startHistoryId) {
    const params = new URLSearchParams({
        startHistoryId,
        historyTypes: "messageAdded",
        labelId: "INBOX",
    });
    try {
        const result = await gmailJson(accessToken, `/history?${params.toString()}`);
        return { history: result.history ?? [], historyId: result.historyId };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("404")) {
            return { history: [] };
        }
        throw err;
    }
}
async function getGmailProfile(accessToken) {
    return gmailJson(accessToken, "/profile");
}
/** Decode Gmail Pub/Sub push payload (base64 JSON with emailAddress + historyId). */
function parseGmailPushNotification(base64Data) {
    try {
        const json = Buffer.from(base64Data, "base64").toString("utf8");
        const data = JSON.parse(json);
        if (!data.emailAddress?.trim() || !data.historyId?.trim())
            return null;
        return {
            emailAddress: data.emailAddress.trim().toLowerCase(),
            historyId: data.historyId.trim(),
        };
    }
    catch {
        return null;
    }
}
/** Register Gmail push watch — requires Pub/Sub topic configured in GCP. */
async function registerGmailWatch(accessToken, topicName) {
    const res = await fetch(`${GMAIL_BASE}/watch`, {
        method: "POST",
        headers: {
            ...gmailHeadersInit(accessToken),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            topicName,
            labelIds: ["INBOX"],
            labelFilterBehavior: "include",
        }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`gmail watch failed: ${res.status}`);
    }
    const data = JSON.parse(text);
    if (!data.historyId || !data.expiration) {
        throw new Error("gmail watch missing historyId or expiration");
    }
    return { historyId: data.historyId, expiration: data.expiration };
}
function gmailOAuthSecretsConfigured() {
    try {
        const clientId = (0, gmailApi_1.trimSecret)(gmailApi_1.gmailClientId.value());
        const clientSecret = (0, gmailApi_1.trimSecret)(gmailApi_1.gmailClientSecret.value());
        return Boolean(clientId && clientSecret);
    }
    catch {
        return false;
    }
}
/** Decode base64url body data from simple single-part text messages (fixtures). */
function decodeGmailBodyData(data) {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
}
//# sourceMappingURL=gmailInbound.js.map