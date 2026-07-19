"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFirstSupplyFormat = detectFirstSupplyFormat;
exports.detectJohnstoneFormat = detectJohnstoneFormat;
exports.routeInvoiceFormat = routeInvoiceFormat;
exports.vendorDisplayNameForFormat = vendorDisplayNameForFormat;
function detectFirstSupplyFormat(text) {
    let score = 0;
    if (/First Supply LLC/i.test(text))
        score += 50;
    if (/firstsupply\.billtrust\.com/i.test(text))
        score += 25;
    if (/Customer P\/O/i.test(text) && /Invoice\s*#/i.test(text) && !/Sales Order\s*#/i.test(text)) {
        score += 15;
    }
    if (/Via\s+(?:COUNTER|EXPRESS)\s+PU/i.test(text))
        score += 10;
    return Math.min(100, score);
}
function detectJohnstoneFormat(text) {
    let score = 0;
    if (/Johnstone Supply/i.test(text))
        score += 45;
    if (/Remit\s+To\s*:/i.test(text))
        score += 20;
    if (/Sales Order\s*#/i.test(text))
        score += 15;
    if (/LN\s+QNTY\s+ORD/i.test(text) || /LN\s+ord\s+ship/i.test(text))
        score += 25;
    if (/LN\s+QNTY\s+QNTY\s+QNTY\s+PRODUCT/i.test(text))
        score += 20;
    if (/Customer\s*#/i.test(text) && /Invoice\s*#/i.test(text))
        score += 10;
    if (/First Supply LLC/i.test(text))
        score = Math.max(0, score - 40);
    return Math.min(100, score);
}
function boostFromSenderDomain(scores, senderEmail) {
    const domain = senderEmail?.split("@")[1]?.toLowerCase().trim();
    if (!domain)
        return;
    if (domain.includes("firstsupply") || domain.includes("1supply")) {
        const row = scores.find((s) => s.id === "first_supply");
        if (row)
            row.score += 20;
    }
    if (domain.includes("johnstone")) {
        const row = scores.find((s) => s.id === "johnstone");
        if (row)
            row.score += 20;
    }
}
/** Pick vendor invoice parser format before normalize/parse — fail closed when ambiguous. */
function routeInvoiceFormat(text, hints) {
    const scores = [
        { id: "first_supply", score: detectFirstSupplyFormat(text) },
        { id: "johnstone", score: detectJohnstoneFormat(text) },
    ];
    boostFromSenderDomain(scores, hints?.senderEmail);
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    const second = scores[1];
    if (!best || best.score < 40) {
        return { formatId: "unknown", confidence: best?.score ?? 0 };
    }
    if (second && second.score >= best.score - 5 && second.score >= 40) {
        return { formatId: "unknown", confidence: best.score };
    }
    return { formatId: best.id, confidence: best.score };
}
function vendorDisplayNameForFormat(formatId) {
    if (formatId === "first_supply")
        return "First Supply";
    if (formatId === "johnstone")
        return "Johnstone Supply";
    return "Unknown vendor";
}
//# sourceMappingURL=vendorInvoiceRouter.js.map