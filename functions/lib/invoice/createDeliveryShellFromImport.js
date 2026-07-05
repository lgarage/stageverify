"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobNameFromInvoiceContext = exports.jobNameFromInvoicePo = exports.SHELL_DELIVERY_ID_PREFIX = void 0;
exports.shellDeliveryIdForImport = shellDeliveryIdForImport;
exports.scoreJobMatchFromInvoiceHints = scoreJobMatchFromInvoiceHints;
exports.jobIdFromInvoicePoSlug = jobIdFromInvoicePoSlug;
exports.jobNumberFromInvoiceHeader = jobNumberFromInvoiceHeader;
exports.buildInvoiceDeliveryShellContext = buildInvoiceDeliveryShellContext;
exports.buildInvoiceShellPatchDocument = buildInvoiceShellPatchDocument;
exports.buildDeliveryShellDocument = buildDeliveryShellDocument;
const https_1 = require("firebase-functions/v2/https");
const loadMatchContext_1 = require("../email/loadMatchContext");
const buildExpectedItemsFromImport_1 = require("./buildExpectedItemsFromImport");
const invoiceShellDisplayHelpers_1 = require("./invoiceShellDisplayHelpers");
const matchInvoiceToRecords_1 = require("./matchInvoiceToRecords");
exports.SHELL_DELIVERY_ID_PREFIX = "delivery-vii-";
function shellDeliveryIdForImport(importId) {
    return `${exports.SHELL_DELIVERY_ID_PREFIX}${importId}`;
}
function asParsedHeader(raw) {
    const str = (key, required = false) => {
        const v = raw[key];
        if (typeof v === "string" && v.trim())
            return v.trim();
        if (required)
            throw new https_1.HttpsError("failed-precondition", `Invoice header missing ${key}.`);
        return "";
    };
    return {
        customerAccountNumber: str("customerAccountNumber", true),
        vendorOrderNumber: str("vendorOrderNumber", true),
        vendorInvoiceNumber: str("vendorInvoiceNumber", true),
        customerPoOrReference: str("customerPoOrReference", true),
        quoteNumber: str("quoteNumber") || undefined,
        orderDate: str("orderDate", true),
        invoiceDate: str("invoiceDate"),
        shipDate: str("shipDate"),
        buyerName: str("buyerName") || undefined,
        shipViaRaw: str("shipViaRaw") || undefined,
        jobNumberRaw: str("jobNumberRaw") || undefined,
        vendorBranchName: str("vendorBranchName", true),
        vendorBranchAddress: str("vendorBranchAddress"),
        vendorBranchPhone: str("vendorBranchPhone"),
        soldToName: str("soldToName"),
        shipToName: str("shipToName"),
        shipToAddress: str("shipToAddress"),
        fulfillmentMethod: raw.fulfillmentMethod === "delivery" ||
            raw.fulfillmentMethod === "will_call_pickup" ||
            raw.fulfillmentMethod === "unknown"
            ? raw.fulfillmentMethod
            : "unknown",
        shipCompletePolicy: raw.shipCompletePolicy === "hold_until_complete" ||
            raw.shipCompletePolicy === "allow_partial" ||
            raw.shipCompletePolicy === "unknown"
            ? raw.shipCompletePolicy
            : "unknown",
    };
}
async function resolveJohnstoneVendor(db) {
    const snap = await db.collection("vendors").limit(100).get();
    for (const doc of snap.docs) {
        const name = doc.data().name;
        if (typeof name === "string" && /johnstone/i.test(name)) {
            return { id: doc.id, name };
        }
    }
    if (!snap.empty) {
        const doc = snap.docs[0];
        const name = doc.data().name;
        return {
            id: doc.id,
            name: typeof name === "string" ? name : "Vendor",
        };
    }
    return null;
}
function normalizeMatchText(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function poHintTokens(customerPoOrReference) {
    return normalizeMatchText(customerPoOrReference)
        .split(/\s+/)
        .filter((token) => token.length >= 3);
}
/** Score how well invoice PO / ship-to hints match a job name or number. */
function scoreJobMatchFromInvoiceHints(header, job) {
    let score = 0;
    const poCompact = normalizeMatchText(header.customerPoOrReference).replace(/\s+/g, "");
    const nameTargets = [
        job.jobName ?? "",
        job.jobNumber,
        header.shipToName ?? "",
        header.soldToName ?? "",
    ].filter(Boolean);
    for (const target of nameTargets) {
        const targetNorm = normalizeMatchText(target);
        const targetCompact = targetNorm.replace(/\s+/g, "");
        if (!targetNorm)
            continue;
        if (poCompact.length >= 4 && targetCompact.includes(poCompact)) {
            score += 24;
            continue;
        }
        const targetParts = targetNorm.split(/\s+/).filter(Boolean);
        for (const token of poHintTokens(header.customerPoOrReference)) {
            if (targetParts.some((part) => part.startsWith(token) || token.startsWith(part))) {
                score += 12;
            }
            else if (targetCompact.includes(token)) {
                score += 10;
            }
        }
    }
    const jobHint = header.jobNumberRaw?.trim().toUpperCase() ?? "";
    if (jobHint && job.jobNumber.toUpperCase() === jobHint) {
        score += 30;
    }
    const customerPo = header.customerPoOrReference.toUpperCase();
    const num = job.jobNumber.toUpperCase();
    if (num && customerPo.includes(num)) {
        score += 20;
    }
    return score;
}
function resolveJobIdFromHints(header, ctx, matchJobId) {
    if (matchJobId)
        return matchJobId;
    const jobHint = header.jobNumberRaw?.trim().toUpperCase() ?? "";
    if (jobHint) {
        const exact = ctx.jobs.filter((j) => j.jobNumber.toUpperCase() === jobHint);
        if (exact.length === 1)
            return exact[0].id;
    }
    const customerPo = header.customerPoOrReference.toUpperCase();
    for (const job of ctx.jobs) {
        const num = job.jobNumber.toUpperCase();
        if (num && customerPo.includes(num))
            return job.id;
    }
    let best;
    for (const job of ctx.jobs) {
        const score = scoreJobMatchFromInvoiceHints(header, job);
        if (score >= 12 && (!best || score > best.score)) {
            best = { id: job.id, score };
        }
    }
    return best?.id;
}
/** Deterministic job doc id for invoice auto-create — idempotent across approve/backfill. */
function jobIdFromInvoicePoSlug(header) {
    const po = normalizeMatchText(header.customerPoOrReference).replace(/\s+/g, "-");
    const inv = normalizeMatchText(header.vendorInvoiceNumber || header.vendorOrderNumber || "import");
    const slug = `${po}-${inv}`.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
    return `job-inv-${slug || "unknown"}`;
}
var invoiceShellDisplayHelpers_2 = require("./invoiceShellDisplayHelpers");
Object.defineProperty(exports, "jobNameFromInvoicePo", { enumerable: true, get: function () { return invoiceShellDisplayHelpers_2.jobNameFromInvoicePo; } });
Object.defineProperty(exports, "jobNameFromInvoiceContext", { enumerable: true, get: function () { return invoiceShellDisplayHelpers_2.jobNameFromInvoiceContext; } });
function jobNumberFromInvoiceHeader(header) {
    const raw = header.jobNumberRaw?.trim();
    if (raw)
        return raw;
    const inv = header.vendorInvoiceNumber?.trim() || header.vendorOrderNumber?.trim();
    if (inv)
        return `INV-${inv}`;
    const year = new Date().getFullYear().toString().slice(-2);
    const poCompact = normalizeMatchText(header.customerPoOrReference).replace(/\s+/g, "");
    return `INV-${year}-${poCompact.slice(0, 12) || "import"}`;
}
async function ensureJobForInvoiceShell(db, header, ctx, matchJobId, orderNotes = []) {
    const resolved = resolveJobIdFromHints(header, ctx, matchJobId);
    if (resolved)
        return { jobId: resolved, jobCreated: false };
    const po = header.customerPoOrReference.trim();
    if (!po) {
        throw new https_1.HttpsError("failed-precondition", "Cannot create dashboard record — no matching job and invoice has no customer P/O to create one.");
    }
    const jobId = jobIdFromInvoicePoSlug(header);
    const existing = await db.collection("jobs").doc(jobId).get();
    if (existing.exists) {
        return { jobId, jobCreated: false };
    }
    const now = new Date().toISOString();
    const resolvedJobName = (0, invoiceShellDisplayHelpers_1.jobNameFromInvoiceContext)(po, orderNotes, header.shipToName);
    await db.collection("jobs").doc(jobId).set({
        id: jobId,
        jobNumber: jobNumberFromInvoiceHeader(header),
        jobName: resolvedJobName,
        status: "active",
        createdFromInvoiceImport: true,
        createdAt: now,
        updatedAt: now,
    });
    return { jobId, jobCreated: true };
}
/** Resolve job/vendor + line items for a dashboard shell — auto-creates job from P/O when unmatched. */
async function buildInvoiceDeliveryShellContext(db, importId, importDoc) {
    const header = asParsedHeader(importDoc.parsedHeader);
    const orderNotes = importDoc.orderNotes ?? [];
    const deliverToLabel = (0, invoiceShellDisplayHelpers_1.extractDeliverToSiteLabel)(orderNotes);
    const deliverToSite = Boolean(deliverToLabel);
    const ctx = await (0, loadMatchContext_1.loadEmailMatchContext)();
    const match = (0, matchInvoiceToRecords_1.matchInvoiceToRecords)(importId, header, ctx);
    const { jobId, jobCreated } = await ensureJobForInvoiceShell(db, header, ctx, match.jobId, orderNotes);
    let vendorId = match.vendorId;
    let vendorName = "Vendor";
    if (vendorId) {
        const vendorSnap = await db.collection("vendors").doc(vendorId).get();
        if (vendorSnap.exists) {
            const name = vendorSnap.data()?.name;
            if (typeof name === "string")
                vendorName = name;
        }
    }
    else {
        const resolved = await resolveJohnstoneVendor(db);
        if (!resolved) {
            throw new https_1.HttpsError("failed-precondition", "Cannot create dashboard record — no vendor record found.");
        }
        vendorId = resolved.id;
        vendorName = resolved.name;
    }
    const deliveryOrderId = shellDeliveryIdForImport(importId);
    const expectedItems = (0, buildExpectedItemsFromImport_1.buildExpectedItemsFromImport)(importId, deliveryOrderId, jobId, importDoc.parsedLines ?? []);
    if (expectedItems.length === 0) {
        throw new https_1.HttpsError("failed-precondition", "No expected product lines to apply.");
    }
    const vendorInvoiceNumber = header.vendorInvoiceNumber;
    const vendorOrderNumber = header.vendorOrderNumber;
    const customerPo = header.customerPoOrReference;
    const evidenceNote = `Imported from Johnstone invoice ${vendorInvoiceNumber || vendorOrderNumber} (Customer P/O: ${customerPo}). Invoice import shell — no shop receipt.`;
    const deliveryDate = header.shipDate?.trim() ||
        header.invoiceDate?.trim() ||
        header.orderDate?.trim() ||
        new Date().toISOString().slice(0, 10);
    const orderNumber = vendorOrderNumber || vendorInvoiceNumber || deliveryOrderId;
    const deliveryStatus = (0, invoiceShellDisplayHelpers_1.resolveShellDeliveryStatus)(importDoc.importStatus, header.fulfillmentMethod, deliverToSite);
    return {
        deliveryOrderId,
        jobId,
        jobCreated,
        vendorId,
        vendorName,
        purchaseOrderId: match.purchaseOrderId,
        orderNumber,
        deliveryDate,
        expectedItems,
        evidenceNote,
        vendorInvoiceNumber,
        vendorOrderNumber,
        customerPo,
        deliveryStatus,
        invoiceFulfillmentMethod: header.fulfillmentMethod,
        invoiceDeliverToSite: deliverToSite,
        ...(deliverToLabel ? { invoiceDeliverToLabel: deliverToLabel } : {}),
    };
}
/** Patch fields for an existing invoice shell — idempotent refresh of display metadata. */
function buildInvoiceShellPatchDocument(shell, importId, importDoc, now) {
    const patch = {
        status: shell.deliveryStatus,
        vendorInvoiceImportId: importId,
        invoiceImportStatus: importDoc.importStatus,
        invoiceFulfillmentMethod: shell.invoiceFulfillmentMethod,
        updatedAt: now,
    };
    if (shell.invoiceDeliverToSite) {
        patch.invoiceDeliverToSite = true;
        if (shell.invoiceDeliverToLabel) {
            patch.invoiceDeliverToLabel = shell.invoiceDeliverToLabel;
        }
    }
    return patch;
}
/** Fields for a new delivery shell — no staging, readiness, or pickup side effects. */
function buildDeliveryShellDocument(shell, importId, importDoc, now) {
    return {
        id: shell.deliveryOrderId,
        orderNumber: shell.orderNumber,
        jobId: shell.jobId,
        vendorId: shell.vendorId,
        vendorName: shell.vendorName,
        ...(shell.purchaseOrderId ? { purchaseOrderId: shell.purchaseOrderId } : {}),
        deliveryDate: shell.deliveryDate,
        status: shell.deliveryStatus,
        vendorInvoiceImportId: importId,
        invoiceImportStatus: importDoc.importStatus,
        invoiceFulfillmentMethod: shell.invoiceFulfillmentMethod,
        ...(shell.invoiceDeliverToSite
            ? {
                invoiceDeliverToSite: true,
                ...(shell.invoiceDeliverToLabel
                    ? { invoiceDeliverToLabel: shell.invoiceDeliverToLabel }
                    : {}),
            }
            : {}),
        createdFromInvoiceImport: true,
        vendorOrderComplete: true,
        vendorOrderCompleteAt: now,
        vendorOrderCompleteSource: "vendor_email",
        ...(shell.vendorInvoiceNumber
            ? { vendorInvoiceNumber: shell.vendorInvoiceNumber }
            : {}),
        ...(shell.vendorOrderNumber ? { vendorOrderNumber: shell.vendorOrderNumber } : {}),
        ...(shell.customerPo ? { customerPoOrReference: shell.customerPo } : {}),
        notes: shell.evidenceNote,
        createdAt: now,
        updatedAt: now,
    };
}
//# sourceMappingURL=createDeliveryShellFromImport.js.map