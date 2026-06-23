"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gmailClientSecret = exports.gmailClientId = void 0;
exports.trimSecret = trimSecret;
exports.refreshGmailAccessToken = refreshGmailAccessToken;
exports.buildGmailRawMessage = buildGmailRawMessage;
exports.sendGmailMessage = sendGmailMessage;
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
function encodeRfc2822Subject(subject) {
    if (/^[\x20-\x7E]*$/.test(subject))
        return subject;
    const encoded = Buffer.from(subject, "utf8").toString("base64");
    return `=?UTF-8?B?${encoded}?=`;
}
/** Base64url-encoded RFC 2822 message for Gmail users.messages.send. */
function buildGmailRawMessage(to, from, subject, bodyText) {
    for (const value of [to, from, subject]) {
        if (/[\r\n]/.test(value)) {
            throw new Error("invalid email header value");
        }
    }
    const message = [
        `To: ${to}`,
        `From: ${from}`,
        `Subject: ${encodeRfc2822Subject(subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        bodyText,
    ].join("\r\n");
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
//# sourceMappingURL=gmailApi.js.map