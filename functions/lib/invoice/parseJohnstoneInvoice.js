"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageTextFingerprint = pageTextFingerprint;
exports.parseJohnstoneInvoicePage = parseJohnstoneInvoicePage;
const inferImportStatus_1 = require("./inferImportStatus");
function capture(label, text) {
    const m = text.match(label);
    return m?.[1]?.trim();
}
function normalizeDate(raw) {
    const parts = raw.trim().split(/[/-]/);
    if (parts.length !== 3)
        return raw.trim();
    let [a, b, c] = parts;
    if (c.length === 2)
        c = `20${c}`;
    const month = a.padStart(2, "0");
    const day = b.padStart(2, "0");
    return `${c}-${month}-${day}`;
}
function parseProductTokens(productCol) {
    const tokens = productCol.trim().split(/\s+/);
    if (tokens.length === 0)
        return { vendorProductNumber: "", descriptionTail: "" };
    const vendorProductNumber = tokens[0] ?? "";
    const manufacturerOrModelNumber = tokens[1];
    const descriptionTail = tokens.slice(2).join(" ");
    return { vendorProductNumber, manufacturerOrModelNumber, descriptionTail };
}
function classifyLine(vendorProductNumber, quantityShipped, description) {
    const upper = vendorProductNumber.toUpperCase();
    const descLower = description.toLowerCase();
    if (/^CORE-/i.test(upper)) {
        return { lineType: "core_charge", excludeFromExpectedItems: true };
    }
    if (quantityShipped < 0 || /return from invoice/i.test(descLower)) {
        return { lineType: "return", excludeFromExpectedItems: true };
    }
    if (/^INBOUND FREIGHT$/i.test(vendorProductNumber) || /^INBOUND FREIGHT$/i.test(description.trim())) {
        return { lineType: "freight", excludeFromExpectedItems: true };
    }
    if (/^FLOOR-LOC:/i.test(description)) {
        return { lineType: "ignored", excludeFromExpectedItems: true };
    }
    return { lineType: "product", excludeFromExpectedItems: false };
}
const LINE_ROW = /^(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s+(.+?)(?:\s{2,}|$)\s*(.*)$/;
function pageTextFingerprint(page) {
    const normalized = page.extractedText.replace(/\s+/g, " ").trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
    }
    return `inv-fp-${hash.toString(16)}`;
}
function parseJohnstoneInvoicePage(page) {
    const text = page.extractedText;
    const parseWarnings = [];
    const orderNotes = [];
    const customerAccountNumber = capture(/Customer\s*#\s*:\s*(\d+)/i, text) ?? "";
    const vendorOrderNumber = capture(/Sales Order\s*#\s*:\s*(\d+)/i, text) ?? "";
    const vendorInvoiceNumber = capture(/Invoice\s*#\s*:\s*(\d+)/i, text) ?? "";
    const customerPoOrReference = capture(/Customer P\/O\s*#\s*:\s*(.+)/i, text) ?? "";
    const quoteNumber = capture(/Quote\s*(?:Number|#)\s*:\s*(\S+)/i, text)
        ?? capture(/Invoice Message[\s\S]*?(Q\d+)/i, text);
    const orderDateRaw = capture(/Order Date\s*:\s*([\d/-]+)/i, text) ?? "";
    const invoiceDateRaw = capture(/Invoice Date\s*:\s*([\d/-]+)/i, text) ?? "";
    const shipDateRaw = capture(/Ship Date\s*:\s*([\d/-]+)/i, text) ?? "";
    const buyerName = capture(/Buyer\s*:\s*(.+)/i, text);
    const shipViaRaw = capture(/Ship Via\s*:\s*(.*)/i, text)?.trim();
    const jobNumberRaw = capture(/Job Number\s*:\s*(.*)/i, text)?.trim();
    const vendorBranchName = capture(/Remit To\s*:\s*(.+)/i, text)
        ?? capture(/^([^\n]+Johnstone Supply)/im, text)
        ?? "Johnstone Supply";
    const vendorBranchAddress = capture(/Remit To\s*:\s*[^\n]+\n([^\n]+(?:SD|WI|MN|IA)\s+\d{5})/i, text) ?? capture(/(\d+[^\n]+(?:SD|WI|MN|IA)\s+\d{5})/i, text)
        ?? "";
    const vendorBranchPhone = capture(/please call\s*([\d-]+)/i, text)
        ?? capture(/(\d{3}-\d{3}-\d{4})/i, text)
        ?? "";
    const soldToName = capture(/Sold To\s*:\s*(.+)/i, text) ?? "";
    const shipToName = capture(/Ship To\s*:\s*(.+)/i, text) ?? soldToName;
    const shipToAddress = capture(/Ship To\s*:\s*[^\n]+\n([^\n]+)/i, text)
        ?? capture(/(\d{4}[^\n]+(?:WI|MN|IA|SD)\s+\d{5})/i, text)
        ?? "";
    if (!customerAccountNumber)
        parseWarnings.push("missing customerAccountNumber");
    if (!vendorOrderNumber)
        parseWarnings.push("missing vendorOrderNumber");
    if (!vendorInvoiceNumber)
        parseWarnings.push("missing vendorInvoiceNumber");
    if (!customerPoOrReference)
        parseWarnings.push("missing customerPoOrReference");
    const fulfillmentMethod = (0, inferImportStatus_1.inferFulfillmentMethod)(customerPoOrReference, shipViaRaw, text);
    const shipCompletePolicy = (0, inferImportStatus_1.inferShipCompletePolicy)(text);
    const header = {
        customerAccountNumber,
        vendorOrderNumber,
        vendorInvoiceNumber,
        customerPoOrReference,
        quoteNumber: quoteNumber || undefined,
        orderDate: orderDateRaw ? normalizeDate(orderDateRaw) : "",
        invoiceDate: invoiceDateRaw ? normalizeDate(invoiceDateRaw) : "",
        shipDate: shipDateRaw ? normalizeDate(shipDateRaw) : "",
        buyerName: buyerName || undefined,
        shipViaRaw: shipViaRaw || undefined,
        jobNumberRaw: jobNumberRaw || undefined,
        vendorBranchName: vendorBranchName.trim(),
        vendorBranchAddress: vendorBranchAddress.trim(),
        vendorBranchPhone: vendorBranchPhone.trim(),
        soldToName: soldToName.trim(),
        shipToName: shipToName.trim(),
        shipToAddress: shipToAddress.trim(),
        fulfillmentMethod,
        shipCompletePolicy,
    };
    const lines = [];
    const lineSection = text.split(/LN\s+QNTY ORD/i)[1] ?? text;
    for (const rawLine of lineSection.split("\n")) {
        const trimmed = rawLine.trim();
        if (!trimmed || /^[-=]+$/.test(trimmed))
            continue;
        const m = trimmed.match(LINE_ROW);
        if (!m) {
            if (/REPAIR/i.test(trimmed))
                orderNotes.push(trimmed);
            else if (/2 DAY LEAD|NON STOCK|RESTOCK FEE/i.test(trimmed)) {
                if (lines.length > 0) {
                    lines[lines.length - 1].filteredNotes.push(trimmed);
                }
            }
            continue;
        }
        const [, ln, ord, ship, bo, productCol, descCol] = m;
        const { vendorProductNumber, manufacturerOrModelNumber, descriptionTail } = parseProductTokens(productCol ?? "");
        const description = [descriptionTail, descCol?.trim()].filter(Boolean).join(" ").trim();
        const quantityShipped = Number(ship);
        const { lineType, excludeFromExpectedItems } = classifyLine(vendorProductNumber, quantityShipped, description);
        lines.push({
            lineNumber: Number(ln),
            quantityOrdered: Number(ord),
            quantityShipped,
            quantityBackordered: Number(bo),
            vendorProductNumber,
            manufacturerOrModelNumber,
            description,
            filteredNotes: [],
            lineType,
            excludeFromExpectedItems,
        });
    }
    return { header, lines, orderNotes, parseWarnings };
}
//# sourceMappingURL=parseJohnstoneInvoice.js.map