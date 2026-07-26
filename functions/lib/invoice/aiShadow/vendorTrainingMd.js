"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeVendorKey = sanitizeVendorKey;
exports.vendorTrainingObjectPath = vendorTrainingObjectPath;
exports.readVendorTrainingMd = readVendorTrainingMd;
exports.appendVendorTrainingLesson = appendVendorTrainingLesson;
const admin = require("firebase-admin");
const constants_1 = require("./constants");
const redactLessonNote_1 = require("./redactLessonNote");
function storage() {
    return admin.storage().bucket(constants_1.INVOICE_TRAINING_BUCKET);
}
/** Sanitize vendor key for object path (no path traversal). */
function sanitizeVendorKey(raw) {
    const key = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return key || "unknown-vendor";
}
function vendorTrainingObjectPath(vendorKey) {
    return `vendors/${sanitizeVendorKey(vendorKey)}.md`;
}
async function readVendorTrainingMd(vendorKey) {
    const file = storage().file(vendorTrainingObjectPath(vendorKey));
    const [exists] = await file.exists();
    if (!exists)
        return "";
    const [buf] = await file.download();
    return buf.toString("utf8").slice(0, constants_1.MAX_VENDOR_MD_BYTES);
}
/**
 * Append a generalized human correction lesson. Returns false if note empty/unsafe.
 * Never stores specific invoice details — caller must pass already-generalized text.
 */
async function appendVendorTrainingLesson(input) {
    const redacted = (0, redactLessonNote_1.redactLessonNote)(input.correctionNote);
    if (!(0, redactLessonNote_1.isSafeLessonNote)(redacted)) {
        return { wrote: false, reason: "note_empty_or_unsafe" };
    }
    const path = vendorTrainingObjectPath(input.vendorKey);
    const file = storage().file(path);
    const [exists] = await file.exists();
    let prior = "";
    if (exists) {
        const [buf] = await file.download();
        prior = buf.toString("utf8");
    }
    if (!prior.trim()) {
        prior =
            `# Vendor invoice playbook — ${sanitizeVendorKey(input.vendorKey)}\n\n` +
                `Generalized rules only. Do not store invoice numbers, POs, addresses, or customer names.\n\n` +
                `## Lessons\n`;
    }
    else if (!prior.includes("## Lessons")) {
        prior = `${prior.trimEnd()}\n\n## Lessons\n`;
    }
    const entry = `\n- (${input.atIso.slice(0, 10)}) Look for: ${redacted}\n`;
    const next = `${prior.trimEnd()}${entry}\n`;
    if (Buffer.byteLength(next, "utf8") > constants_1.MAX_VENDOR_MD_BYTES) {
        return { wrote: false, reason: "md_size_cap" };
    }
    await file.save(next, {
        contentType: "text/markdown; charset=utf-8",
        resumable: false,
        metadata: {
            cacheControl: "private, max-age=0",
        },
    });
    return { wrote: true };
}
//# sourceMappingURL=vendorTrainingMd.js.map