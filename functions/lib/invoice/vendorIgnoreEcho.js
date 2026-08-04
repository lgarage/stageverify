"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSenderDomain = extractSenderDomain;
exports.normalizeSenderDomains = normalizeSenderDomains;
exports.computeEchoToken = computeEchoToken;
exports.buildProposeEchoText = buildProposeEchoText;
exports.armableFingerprintError = armableFingerprintError;
/**
 * Server-echo helpers for teach-chat ignore rule propose/confirm (D-59 P1).
 */
const node_crypto_1 = require("node:crypto");
const inferDocumentType_1 = require("./inferDocumentType");
function extractSenderDomain(senderEmail) {
    const trimmed = senderEmail.trim();
    const angle = trimmed.match(/<([^>]+)>/);
    const email = (angle?.[1] ?? trimmed).trim().toLowerCase();
    if (!email.includes("@"))
        return null;
    const domain = email.split("@")[1]?.trim();
    return domain && domain.length > 0 && domain.length <= 253 ? domain : null;
}
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** Bare hostname or From-style email → lowercase domain; rejects junk. Max 5 unique. */
function normalizeSenderDomains(raw) {
    const inputs = [];
    if (typeof raw === "string") {
        inputs.push(raw);
    }
    else if (Array.isArray(raw)) {
        for (const entry of raw) {
            if (typeof entry === "string")
                inputs.push(entry);
        }
    }
    const out = [];
    const seen = new Set();
    for (const item of inputs) {
        const trimmed = item.trim();
        if (!trimmed)
            continue;
        let domain = extractSenderDomain(trimmed);
        if (domain && !HOSTNAME_RE.test(domain))
            domain = null;
        if (!domain && !trimmed.includes("@")) {
            const host = trimmed.toLowerCase();
            if (host.length >= 3 &&
                host.length <= 253 &&
                !host.includes(" ") &&
                !host.includes("/") &&
                HOSTNAME_RE.test(host)) {
                domain = host;
            }
        }
        if (!domain || seen.has(domain))
            continue;
        seen.add(domain);
        out.push(domain);
        if (out.length >= 5)
            break;
    }
    return out;
}
/** SHA-256 of importId|vendorKey|parserFormatId|documentType|senderDomainsJoined|importUpdatedAt */
function computeEchoToken(input) {
    const payload = [
        input.importId,
        input.vendorKey,
        input.parserFormatId,
        input.documentType,
        input.senderDomains.join(","),
        input.importUpdatedAt,
    ].join("|");
    return (0, node_crypto_1.createHash)("sha256").update(payload).digest("hex");
}
function buildProposeEchoText(input) {
    const { fingerprint, vendorLabel, senderDomains } = input;
    const typeLabel = (0, inferDocumentType_1.documentTypeLabel)(fingerprint.documentType);
    const domainText = senderDomains.length === 1
        ? senderDomains[0]
        : senderDomains.join(", ");
    const lines = [
        `I understand: automatically skip future ${typeLabel} imports for ${vendorLabel} (format: ${fingerprint.parserFormatId}).`,
        `Sender domain: ${domainText}.`,
        "New matching documents will be auto-moved to Rejected (recoverable). Nothing is deleted.",
        "A manager must activate this rule before it takes effect.",
    ];
    if (fingerprint.documentType === "credit_memo") {
        lines.push("Note: this is separate from structural credit-return auto-skip — taught rules match by vendor, format, and document type.");
    }
    return lines.join(" ");
}
function armableFingerprintError(fp) {
    if (fp.vendorKey === "unknown-vendor" || !fp.vendorKey.trim()) {
        return "Vendor unknown — link a vendor first.";
    }
    if (fp.parserFormatId === "unknown") {
        return "Cannot ignore documents with an unknown parser format — resolve the format first.";
    }
    if (fp.documentType === "unknown") {
        return "Cannot ignore documents with an unknown type — the document must be classifiable first.";
    }
    if (fp.documentType === "invoice") {
        return "Cannot ignore documents that look like invoices.";
    }
    if (fp.documentType !== "sales_order_confirmation" &&
        fp.documentType !== "credit_memo") {
        return "This document type cannot be used for an ignore rule.";
    }
    return null;
}
//# sourceMappingURL=vendorIgnoreEcho.js.map