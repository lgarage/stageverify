"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planBusinessInvoiceDeliveryIndexBackfill = planBusinessInvoiceDeliveryIndexBackfill;
exports.buildBackfillKeyDocument = buildBackfillKeyDocument;
const businessInvoiceIdentity_1 = require("./businessInvoiceIdentity");
const invoiceDeliveryIndex_1 = require("./invoiceDeliveryIndex");
function headerStr(header, key) {
    return String(header[key] ?? "").trim();
}
function planBusinessInvoiceDeliveryIndexBackfill(input) {
    const deliveryById = new Map(input.deliveries.map((d) => [d.id, d]));
    const entries = [];
    const skippedNoDelivery = [];
    const byInvoice = new Map();
    for (const row of input.imports) {
        const header = row.parsedHeader ?? {};
        const vendorInvoiceNumber = headerStr(header, "vendorInvoiceNumber");
        const identity = (0, businessInvoiceIdentity_1.tryBuildBusinessInvoiceIdentity)({
            detectedVendorId: row.detectedVendorId,
            detectedVendorName: row.detectedVendorName,
            parserFormatId: row.parserFormatId,
            vendorInvoiceNumber,
            customerPoOrReference: headerStr(header, "customerPoOrReference"),
            vendorOrderNumber: headerStr(header, "vendorOrderNumber"),
            fulfillmentMethod: headerStr(header, "fulfillmentMethod"),
            parsedLines: row.parsedLines ?? [],
        });
        if (!identity)
            continue;
        const linked = String(row.linkedDeliveryOrderId ?? "").trim();
        const deliveryId = linked ||
            (row.reviewStatus === "approved" && deliveryById.has(`delivery-vii-${row.id}`)
                ? `delivery-vii-${row.id}`
                : "");
        if (!deliveryId) {
            skippedNoDelivery.push(row.id);
            continue;
        }
        const indexKeyDocId = (0, invoiceDeliveryIndex_1.businessInvoiceDeliveryIndexKeyDocId)(identity, row.parserFormatId, headerStr(header, "vendorOrderNumber"));
        entries.push({
            indexKeyDocId,
            deliveryOrderId: deliveryId,
            canonicalImportId: row.id,
            normalizedInvoiceNumber: identity.normalizedInvoiceNumber,
            vendorOrderNumber: headerStr(header, "vendorOrderNumber"),
        });
        const inv = identity.normalizedInvoiceNumber;
        const bucket = byInvoice.get(inv) ?? {
            deliveries: new Set(),
            imports: new Set(),
            orders: new Set(),
        };
        bucket.deliveries.add(deliveryId);
        bucket.imports.add(row.id);
        const order = headerStr(header, "vendorOrderNumber").toUpperCase();
        if (order)
            bucket.orders.add(order);
        byInvoice.set(inv, bucket);
    }
    const duplicates = [];
    const ambiguous = [];
    for (const [inv, bucket] of byInvoice) {
        if (bucket.deliveries.size > 1) {
            duplicates.push({
                normalizedInvoiceNumber: inv,
                deliveryIds: [...bucket.deliveries],
                importIds: [...bucket.imports],
            });
        }
        if (bucket.orders.size > 1) {
            ambiguous.push({
                normalizedInvoiceNumber: inv,
                reason: "multiple_sales_orders",
                importIds: [...bucket.imports],
                deliveryIds: [...bucket.deliveries],
            });
        }
    }
    // De-dupe plan entries: first wins per index key.
    const seenKeys = new Set();
    const dedupedEntries = entries.filter((e) => {
        if (seenKeys.has(e.indexKeyDocId))
            return false;
        seenKeys.add(e.indexKeyDocId);
        return true;
    });
    return {
        entries: dedupedEntries,
        duplicates,
        ambiguous,
        skippedNoDelivery,
    };
}
function buildBackfillKeyDocument(entry, importRow, now) {
    const header = importRow.parsedHeader ?? {};
    const identity = (0, businessInvoiceIdentity_1.tryBuildBusinessInvoiceIdentity)({
        detectedVendorId: importRow.detectedVendorId,
        detectedVendorName: importRow.detectedVendorName,
        parserFormatId: importRow.parserFormatId,
        vendorInvoiceNumber: headerStr(header, "vendorInvoiceNumber"),
        customerPoOrReference: headerStr(header, "customerPoOrReference"),
        vendorOrderNumber: headerStr(header, "vendorOrderNumber"),
        fulfillmentMethod: headerStr(header, "fulfillmentMethod"),
        parsedLines: importRow.parsedLines ?? [],
    });
    if (!identity) {
        throw new Error(`cannot build identity for import ${importRow.id}`);
    }
    const fp = (0, businessInvoiceIdentity_1.businessInvoiceContentFingerprint)({
        normalizedInvoiceNumber: identity.normalizedInvoiceNumber,
        customerPoOrReference: headerStr(header, "customerPoOrReference"),
        vendorOrderNumber: headerStr(header, "vendorOrderNumber"),
        fulfillmentMethod: headerStr(header, "fulfillmentMethod"),
        parsedLines: importRow.parsedLines ?? [],
    });
    return {
        vendorScope: identity.vendorScope,
        vendorKey: identity.vendorKey,
        normalizedInvoiceNumber: identity.normalizedInvoiceNumber,
        canonicalImportId: entry.canonicalImportId,
        canonicalGmailMessageId: importRow.gmailMessageId ?? "",
        contentFingerprint: fp,
        deliveryOrderId: entry.deliveryOrderId,
        createdAt: now,
        updatedAt: now,
        ...((0, invoiceDeliveryIndex_1.invoiceNumberIsBossForParser)(importRow.parserFormatId)
            ? {}
            : {
                indexDisambiguator: "sales_order",
                vendorOrderNumber: headerStr(header, "vendorOrderNumber"),
            }),
    };
}
//# sourceMappingURL=backfillBusinessInvoiceDeliveryIndexPlan.js.map