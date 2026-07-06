"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRACKING_SUBJECT_PREFIX = void 0;
exports.generateTrackingToken = generateTrackingToken;
exports.formatSubjectTag = formatSubjectTag;
exports.subjectWithTrackingTag = subjectWithTrackingTag;
exports.buildPlusReplyTo = buildPlusReplyTo;
exports.formatBodyTrackingFooter = formatBodyTrackingFooter;
exports.bodyHasSignatureOrFooter = bodyHasSignatureOrFooter;
exports.assembleOutboundEmailBody = assembleOutboundEmailBody;
exports.extractTokenFromSubject = extractTokenFromSubject;
exports.extractTokenFromAddress = extractTokenFromAddress;
exports.extractTokenFromAddresses = extractTokenFromAddresses;
exports.extractTokenFromBody = extractTokenFromBody;
exports.tokensEqual = tokensEqual;
/**
 * Deterministic SV tracking tokens for outbound vendor email (Stage 1).
 * Tokens are random UUIDs — never derived from record ids.
 */
const crypto_1 = require("crypto");
exports.TRACKING_SUBJECT_PREFIX = "SV-";
/** Generate a new tracking token (128-bit UUID). */
function generateTrackingToken() {
    return (0, crypto_1.randomUUID)();
}
/** Subject tag: [SV-<uuid>] */
function formatSubjectTag(token) {
    return `[${exports.TRACKING_SUBJECT_PREFIX}${token}]`;
}
/** Prepend subject tag when absent. */
function subjectWithTrackingTag(subject, token) {
    const tag = formatSubjectTag(token);
    if (subject.includes(tag))
        return subject;
    return `${tag} ${subject}`.trim();
}
/** Plus-address Reply-To: local+t-<token>@domain (Gmail delivers to base inbox). */
function buildPlusReplyTo(baseEmail, token) {
    const at = baseEmail.lastIndexOf("@");
    if (at <= 0)
        return baseEmail;
    const local = baseEmail.slice(0, at);
    const domain = baseEmail.slice(at + 1);
    const compact = token.replace(/-/g, "");
    return `${local}+t-${compact}@${domain}`;
}
/** Human-visible body footer (secondary match signal — not load-bearing). */
function formatBodyTrackingFooter(token) {
    return `\n\n---\nRef: ${exports.TRACKING_SUBJECT_PREFIX}${token}`;
}
const DEFAULT_OUTBOUND_SIGNATURE = "Thanks,\nL. Garage Dispatch";
/** True when the user body already ends with a sign-off or tracking footer. */
function bodyHasSignatureOrFooter(body) {
    const trimmed = body.trim();
    if (!trimmed)
        return false;
    if (/Ref:\s*SV-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(trimmed)) {
        return true;
    }
    if (/\n---(?:\s*\n|\s*$)/.test(trimmed))
        return true;
    const tail = trimmed.split("\n").slice(-3).join("\n");
    if (/^(?:thanks|thank you|regards|best|sincerely),?\s*$/im.test(tail)) {
        return true;
    }
    if (/L\.\s*Garage\s+Dispatch/i.test(trimmed))
        return true;
    return false;
}
/** User message + optional default signature + Ref footer (Ref always last). */
function assembleOutboundEmailBody(body, token) {
    const trimmed = body.trimEnd();
    const withSignature = bodyHasSignatureOrFooter(trimmed)
        ? trimmed
        : `${trimmed}\n\n${DEFAULT_OUTBOUND_SIGNATURE}`;
    return `${withSignature}${formatBodyTrackingFooter(token)}`;
}
const SUBJECT_TOKEN_RE = new RegExp(`\\[${exports.TRACKING_SUBJECT_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\]`, "i");
const PLUS_TOKEN_RE = /\+t-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i;
/** Extract token from subject tag [SV-uuid]. */
function extractTokenFromSubject(subject) {
    const m = subject.match(SUBJECT_TOKEN_RE);
    if (!m?.[1])
        return null;
    return normalizeToken(m[1]);
}
/** Extract token from plus-address in To/Cc/Delivered-To. */
function extractTokenFromAddress(address) {
    const m = address.match(PLUS_TOKEN_RE);
    if (!m?.[1])
        return null;
    const raw = m[1];
    if (raw.includes("-"))
        return normalizeToken(raw);
    // 32 hex chars without dashes → rehydrate UUID format for lookup
    if (raw.length === 32) {
        return normalizeToken(`${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`);
    }
    return null;
}
function extractTokenFromAddresses(addresses) {
    for (const addr of addresses) {
        const token = extractTokenFromAddress(addr);
        if (token)
            return token;
    }
    return null;
}
/** Extract token from body footer Ref: SV-uuid */
function extractTokenFromBody(body) {
    const footerRe = new RegExp(`Ref:\\s*${exports.TRACKING_SUBJECT_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`, "i");
    const m = body.match(footerRe);
    if (!m?.[1])
        return null;
    return normalizeToken(m[1]);
}
function normalizeToken(token) {
    return token.trim().toLowerCase();
}
function tokensEqual(a, b) {
    if (!a || !b)
        return false;
    return normalizeToken(a) === normalizeToken(b);
}
//# sourceMappingURL=trackingToken.js.map