"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gmailClientSecret = exports.gmailClientId = void 0;
exports.trimSecret = trimSecret;
exports.refreshGmailAccessToken = refreshGmailAccessToken;
exports.containsCrlfInEmailHeader = containsCrlfInEmailHeader;
exports.assertSafeEmailHeaderValue = assertSafeEmailHeaderValue;
exports.buildGmailRawMessage = buildGmailRawMessage;
exports.sendGmailMessage = sendGmailMessage;
exports.getGmailMessageMetadata = getGmailMessageMetadata;
/**
 * Gmail OAuth token refresh + send helpers (server-side only).
 * Never log tokens or refresh responses.
 */
const params_1 = require("firebase-functions/params");
exports.gmailClientId = (0, params_1.defineSecret)("GMAIL_OAUTH_CLIENT_ID");
exports.gmailClientSecret = (0, params_1.defineSecret)("GMAIL_OAUTH_CLIENT_SECRET");
function trimSecret(value) {
    return (value ?? "").trim();
}
async function refreshGmailAccessToken(refreshToken) {
    const clientId = trimSecret(exports.gmailClientId.value());
    const clientSecret = trimSecret(exports.gmailClientSecret.value());
    if (!clientId || !clientSecret) {
        throw new Error("Gmail OAuth client credentials not configured");
    }
    const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`token refresh failed: ${res.status}`);
    }
    const data = JSON.parse(text);
    if (!data.access_token) {
        throw new Error("token refresh missing access_token");
    }
    return data.access_token;
}
/** True when value contains CR or LF (RFC 2822 header injection). */
function containsCrlfInEmailHeader(value) {
    return /[\r\n]/.test(value);
}
function assertSafeEmailHeaderValue(value, field) {
    if (containsCrlfInEmailHeader(value)) {
        throw new Error(`invalid email header value: ${field}`);
    }
}
function formatEmailHeader(name, value) {
    assertSafeEmailHeaderValue(name, "header name");
    assertSafeEmailHeaderValue(value, name);
    return `${name}: ${value}`;
}
function encodeRfc2822Subject(subject) {
    assertSafeEmailHeaderValue(subject, "Subject");
    const encoded = /^[\x20-\x7E]*$/.test(subject)
        ? subject
        : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
    assertSafeEmailHeaderValue(encoded, "Subject (encoded)");
    return encoded;
}
function formatFromHeader(fromEmail, displayName) {
    if (!displayName?.trim())
        return fromEmail;
    assertSafeEmailHeaderValue(displayName, "From display name");
    const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}" <${fromEmail}>`;
}
/** Base64url-encoded RFC 2822 message for Gmail users.messages.send. */
function buildGmailRawMessage(to, from, subject, bodyText, options) {
    const opts = typeof options === "string" ? { replyTo: options } : (options ?? {});
    assertSafeEmailHeaderValue(to, "To");
    assertSafeEmailHeaderValue(from, "From");
    assertSafeEmailHeaderValue(subject, "Subject");
    if (opts.replyTo !== undefined) {
        assertSafeEmailHeaderValue(opts.replyTo, "Reply-To");
    }
    const fromHeader = formatFromHeader(from, opts.fromDisplayName);
    const headerLines = [
        formatEmailHeader("To", to),
        formatEmailHeader("From", fromHeader),
        formatEmailHeader("Subject", encodeRfc2822Subject(subject)),
    ];
    if (opts.replyTo !== undefined) {
        headerLines.push(formatEmailHeader("Reply-To", opts.replyTo));
    }
    headerLines.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 7bit");
    const message = [...headerLines, "", bodyText].join("\r\n");
    return Buffer.from(message, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
async function sendGmailMessage(accessToken, raw) {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`gmail send failed: ${res.status}`);
    }
    const data = JSON.parse(text);
    if (!data.id) {
        throw new Error("gmail send missing message id");
    }
    return { id: data.id, threadId: data.threadId };
}
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Fetch RFC 822 Message-ID after send (Gmail send API returns only internal id). */
async function getGmailMessageMetadata(accessToken, messageId) {
    const params = new URLSearchParams({
        format: "metadata",
        metadataHeaders: "Message-ID",
    });
    const res = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`gmail metadata failed: ${res.status}`);
    }
    const data = JSON.parse(text);
    let rfc822MessageId;
    for (const h of data.payload?.headers ?? []) {
        if (h.name?.toLowerCase() === "message-id" && h.value) {
            rfc822MessageId = h.value.trim();
            break;
        }
    }
    return { rfc822MessageId, threadId: data.threadId };
}
//# sourceMappingURL=gmailApi.js.map