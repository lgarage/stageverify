"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInvoiceAiShadow = runInvoiceAiShadow;
exports.isInvoiceAiShadowEnabled = isInvoiceAiShadowEnabled;
const constants_1 = require("./constants");
const validateAiParse_1 = require("./validateAiParse");
const vendorTrainingMd_1 = require("./vendorTrainingMd");
const vertexGenerate_1 = require("./vertexGenerate");
const EXTRACT_SYSTEM = `You extract Johnstone HVAC supply invoice fields from plain text.
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
const VALIDATOR_SYSTEM = `You are the validator for a cheaper model's Johnstone invoice parse.
Return ONLY JSON:
{
  "parse": {
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
  },
  "verdict": "pass" | "fail",
  "issues": string[]
}
Rules:
- Compare the draft parse to the invoice text (qty-only — no dollar/AP totals).
- If the draft is correct, return it in parse with verdict "pass".
- If wrong or incomplete, correct parse from the source and set verdict "fail" with short issues.
- Do not invent lines. Prefer unknown fulfillment over guessing.
- Follow vendor playbook lessons (generalized rules only).`;
function playbookPrefix(playbook) {
    return playbook.trim()
        ? `## Vendor playbook\n${playbook.slice(0, 8000)}\n\n`
        : "";
}
async function callLiteExtract(extractText, playbook) {
    return (0, vertexGenerate_1.vertexGenerateJson)({
        modelId: constants_1.MODEL_FLASH_LITE,
        thinkingLevel: "minimal",
        systemInstruction: EXTRACT_SYSTEM,
        userText: `${playbookPrefix(playbook)}## Invoice text\n${extractText}`,
    });
}
async function callFlashValidator(extractText, playbook, liteParse) {
    const draft = JSON.stringify(liteParse).slice(0, 12000);
    return (0, vertexGenerate_1.vertexGenerateJson)({
        modelId: constants_1.MODEL_FLASH,
        thinkingLevel: "medium",
        systemInstruction: VALIDATOR_SYSTEM,
        userText: `${playbookPrefix(playbook)}## Draft parse (from gemini-3.5-flash-lite)\n` +
            `${draft}\n\n## Invoice text\n${extractText}`,
    });
}
function unwrapValidator(raw) {
    if (!raw || typeof raw !== "object") {
        return { parse: raw };
    }
    const obj = raw;
    if ("parse" in obj) {
        const verdict = obj.verdict === "pass" || obj.verdict === "fail" ? obj.verdict : undefined;
        const issues = Array.isArray(obj.issues)
            ? obj.issues.filter((x) => typeof x === "string").slice(0, 12)
            : undefined;
        return { parse: obj.parse, verdict, issues };
    }
    // Model returned bare parse shape
    return { parse: raw };
}
function pickFinal(input) {
    const { liteVal, flashVal, liteRaw, flashParse } = input;
    if (flashVal.ok) {
        return {
            chosen: flashParse,
            finalModel: constants_1.MODEL_FLASH,
            gateFailures: [],
        };
    }
    if (liteVal.ok) {
        return {
            chosen: liteRaw,
            finalModel: constants_1.MODEL_FLASH_LITE,
            gateFailures: [],
        };
    }
    if (flashVal.failures.length < liteVal.failures.length) {
        return {
            chosen: flashParse,
            finalModel: constants_1.MODEL_FLASH,
            gateFailures: flashVal.failures,
        };
    }
    return {
        chosen: liteRaw,
        finalModel: constants_1.MODEL_FLASH_LITE,
        gateFailures: liteVal.failures,
    };
}
/**
 * Johnstone-only AI shadow: Flash-Lite extract → always 3.6 Flash validator.
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
    let liteRaw;
    try {
        liteRaw = await callLiteExtract(input.extractedText, playbook);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "lite_failed";
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
    const liteVal = tryValidate(liteRaw);
    let flashParse = liteRaw;
    let flashVal = liteVal;
    let validatorVerdict;
    let validatorError;
    try {
        const validatorRaw = await callFlashValidator(input.extractedText, playbook, liteRaw);
        const unwrapped = unwrapValidator(validatorRaw);
        flashParse = unwrapped.parse;
        flashVal = tryValidate(flashParse);
        validatorVerdict = unwrapped.verdict;
    }
    catch (err) {
        // 3.6 failed — fall back to Lite for chosen metrics; still record that validate was attempted.
        validatorError = err instanceof Error ? err.message : "validator_failed";
        flashParse = liteRaw;
        flashVal = {
            ok: false,
            failures: ["json_schema_failure"],
        };
    }
    const picked = pickFinal({ liteVal, flashVal, liteRaw, flashParse });
    const out = picked.chosen;
    const bothFailed = !liteVal.ok && !flashVal.ok;
    return {
        enabled: true,
        ranAt,
        vendorKey,
        finalModel: picked.finalModel,
        escalated: !liteVal.ok,
        validatedBy: constants_1.MODEL_FLASH,
        gateFailures: picked.gateFailures,
        liteGateFailures: liteVal.failures,
        validatorGateFailures: flashVal.failures,
        ...(validatorVerdict ? { validatorVerdict } : {}),
        qtyMatchRegex: (0, validateAiParse_1.qtyLinesMatchRegex)(out, input.regexLines),
        ...(validatorError
            ? { error: validatorError.slice(0, 240) }
            : bothFailed
                ? { error: "gates_failed_after_validate" }
                : {}),
    };
}
async function isInvoiceAiShadowEnabled(db) {
    const snap = await db.collection("appSettings").doc("config").get();
    return snap.exists && snap.data()?.invoiceAiShadowEnabled === true;
}
//# sourceMappingURL=runInvoiceAiShadow.js.map