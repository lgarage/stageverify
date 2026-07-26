"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInvoiceAiShadow = runInvoiceAiShadow;
exports.isInvoiceAiShadowEnabled = isInvoiceAiShadowEnabled;
const constants_1 = require("./constants");
const validateAiParse_1 = require("./validateAiParse");
const vendorTrainingMd_1 = require("./vendorTrainingMd");
const vertexGenerate_1 = require("./vertexGenerate");
const SYSTEM = `You extract Johnstone HVAC supply invoice fields from plain text.
Return ONLY JSON:
{
  "header": {
    "vendorInvoiceNumber": string,
    "vendorOrderNumber": string,
    "customerPoOrReference": string,
    "fulfillmentMethod": "delivery" | "will_call_pickup" | "unknown"
  },
  "lines": [{
    "quantityOrdered": number,
    "quantityShipped": number,
    "quantityBackordered": number,
    "vendorProductNumber": string,
    "description": string,
    "lineType": "product" | "core_charge" | "return" | "freight" | "ignored"
  }],
  "evidenceNotes": string[]
}
Rules:
- Qty-only: ordered should equal shipped + backordered for product lines.
- evidenceNotes: short phrases copied from the source that justify invoice #, order #, and qty rows.
- Do not invent line items. Prefer unknown fulfillment over guessing.
- Follow any vendor playbook lessons below (generalized rules only).`;
async function callModel(modelId, thinkingLevel, extractText, playbook) {
    const userText = (playbook.trim()
        ? `## Vendor playbook\n${playbook.slice(0, 8000)}\n\n`
        : "") + `## Invoice text\n${extractText}`;
    return (0, vertexGenerate_1.vertexGenerateJson)({
        modelId,
        thinkingLevel,
        systemInstruction: SYSTEM,
        userText,
    });
}
/**
 * Johnstone-only AI shadow cascade: Flash-Lite → 3.6 Flash.
 * Never changes reviewStatus / deliveries — caller stores structured result only.
 */
async function runInvoiceAiShadow(input) {
    const ranAt = new Date().toISOString();
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey || "johnstone");
    if ((0, validateAiParse_1.isCorruptExtractedText)(input.extractedText)) {
        return {
            enabled: true,
            ranAt,
            vendorKey,
            finalModel: "none",
            escalated: false,
            gateFailures: ["corrupt_extracted_text"],
            qtyMatchRegex: null,
            error: "corrupt_extracted_text",
        };
    }
    let playbook = "";
    try {
        playbook = await (0, vendorTrainingMd_1.readVendorTrainingMd)(vendorKey);
    }
    catch {
        playbook = "";
    }
    const hasVendorPlaybook = playbook.trim().length > 0;
    const tryValidate = (raw) => (0, validateAiParse_1.validateAiShadowOutput)(raw, {
        hasVendorPlaybook,
        parserFormatId: input.parserFormatId,
    });
    try {
        const liteRaw = await callModel(constants_1.MODEL_FLASH_LITE, "minimal", input.extractedText, playbook);
        const liteVal = tryValidate(liteRaw);
        if (liteVal.ok) {
            const out = liteRaw;
            return {
                enabled: true,
                ranAt,
                vendorKey,
                finalModel: constants_1.MODEL_FLASH_LITE,
                escalated: false,
                gateFailures: [],
                qtyMatchRegex: (0, validateAiParse_1.qtyLinesMatchRegex)(out, input.regexLines),
            };
        }
        const flashRaw = await callModel(constants_1.MODEL_FLASH, "medium", input.extractedText, playbook);
        const flashVal = tryValidate(flashRaw);
        const out = flashVal.ok ? flashRaw : null;
        return {
            enabled: true,
            ranAt,
            vendorKey,
            finalModel: constants_1.MODEL_FLASH,
            escalated: true,
            gateFailures: flashVal.ok ? [] : flashVal.failures,
            qtyMatchRegex: out ? (0, validateAiParse_1.qtyLinesMatchRegex)(out, input.regexLines) : null,
            ...(flashVal.ok ? {} : { error: "gates_failed_after_escalate" }),
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "shadow_failed";
        return {
            enabled: true,
            ranAt,
            vendorKey,
            finalModel: "none",
            escalated: false,
            gateFailures: ["json_schema_failure"],
            qtyMatchRegex: null,
            error: message.slice(0, 240),
        };
    }
}
async function isInvoiceAiShadowEnabled(db) {
    const snap = await db.collection("appSettings").doc("config").get();
    return snap.exists && snap.data()?.invoiceAiShadowEnabled === true;
}
//# sourceMappingURL=runInvoiceAiShadow.js.map