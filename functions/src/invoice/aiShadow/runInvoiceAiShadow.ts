import type { Firestore } from "firebase-admin/firestore";
import { MODEL_FLASH, MODEL_FLASH_LITE } from "./constants";
import {
  isCorruptExtractedText,
  qtyLinesMatchRegex,
  validateAiShadowOutput,
  type AiShadowGateId,
  type AiShadowModelOutput,
} from "./validateAiParse";
import { readVendorTrainingMd, sanitizeVendorKey } from "./vendorTrainingMd";
import { vertexGenerateJson } from "./vertexGenerate";

export interface AiShadowParseRecord {
  enabled: true;
  ranAt: string;
  vendorKey: string;
  finalModel: typeof MODEL_FLASH_LITE | typeof MODEL_FLASH | "none";
  /** True when Flash-Lite failed deterministic gates (3.6 still always validates). */
  escalated: boolean;
  /** Set whenever the 3.6 Flash validator ran. */
  validatedBy?: typeof MODEL_FLASH;
  gateFailures: AiShadowGateId[];
  liteGateFailures?: AiShadowGateId[];
  validatorGateFailures?: AiShadowGateId[];
  validatorVerdict?: "pass" | "fail";
  qtyMatchRegex: boolean | null;
  error?: string;
}

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

function playbookPrefix(playbook: string): string {
  return playbook.trim()
    ? `## Vendor playbook\n${playbook.slice(0, 8000)}\n\n`
    : "";
}

async function callLiteExtract(
  extractText: string,
  playbook: string,
): Promise<unknown> {
  return vertexGenerateJson({
    modelId: MODEL_FLASH_LITE,
    thinkingLevel: "minimal",
    systemInstruction: EXTRACT_SYSTEM,
    userText: `${playbookPrefix(playbook)}## Invoice text\n${extractText}`,
  });
}

async function callFlashValidator(
  extractText: string,
  playbook: string,
  liteParse: unknown,
): Promise<unknown> {
  const draft = JSON.stringify(liteParse).slice(0, 12000);
  return vertexGenerateJson({
    modelId: MODEL_FLASH,
    thinkingLevel: "medium",
    systemInstruction: VALIDATOR_SYSTEM,
    userText:
      `${playbookPrefix(playbook)}## Draft parse (from gemini-3.5-flash-lite)\n` +
      `${draft}\n\n## Invoice text\n${extractText}`,
  });
}

function unwrapValidator(raw: unknown): {
  parse: unknown;
  verdict?: "pass" | "fail";
  issues?: string[];
} {
  if (!raw || typeof raw !== "object") {
    return { parse: raw };
  }
  const obj = raw as Record<string, unknown>;
  if ("parse" in obj) {
    const verdict =
      obj.verdict === "pass" || obj.verdict === "fail" ? obj.verdict : undefined;
    const issues = Array.isArray(obj.issues)
      ? obj.issues.filter((x): x is string => typeof x === "string").slice(0, 12)
      : undefined;
    return { parse: obj.parse, verdict, issues };
  }
  // Model returned bare parse shape
  return { parse: raw };
}

function pickFinal(input: {
  liteVal: { ok: boolean; failures: AiShadowGateId[] };
  flashVal: { ok: boolean; failures: AiShadowGateId[] };
  liteRaw: unknown;
  flashParse: unknown;
}): {
  chosen: unknown;
  finalModel: typeof MODEL_FLASH_LITE | typeof MODEL_FLASH;
  gateFailures: AiShadowGateId[];
} {
  const { liteVal, flashVal, liteRaw, flashParse } = input;
  if (flashVal.ok) {
    return {
      chosen: flashParse,
      finalModel: MODEL_FLASH,
      gateFailures: [],
    };
  }
  if (liteVal.ok) {
    return {
      chosen: liteRaw,
      finalModel: MODEL_FLASH_LITE,
      gateFailures: [],
    };
  }
  if (flashVal.failures.length < liteVal.failures.length) {
    return {
      chosen: flashParse,
      finalModel: MODEL_FLASH,
      gateFailures: flashVal.failures,
    };
  }
  return {
    chosen: liteRaw,
    finalModel: MODEL_FLASH_LITE,
    gateFailures: liteVal.failures,
  };
}

/**
 * Johnstone-only AI shadow: Flash-Lite extract → always 3.6 Flash validator.
 * Never changes reviewStatus / deliveries — caller stores structured result only.
 */
export async function runInvoiceAiShadow(input: {
  extractedText: string;
  vendorKey: string;
  parserFormatId?: string;
  regexLines: Array<{
    quantityOrdered: number;
    quantityShipped: number;
    quantityBackordered: number;
    lineType?: string;
    excludeFromExpectedItems?: boolean;
  }>;
}): Promise<AiShadowParseRecord> {
  const ranAt = new Date().toISOString();
  const vendorKey = sanitizeVendorKey(input.vendorKey || "johnstone");

  if (isCorruptExtractedText(input.extractedText)) {
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
    playbook = await readVendorTrainingMd(vendorKey);
  } catch {
    playbook = "";
  }
  const hasVendorPlaybook = playbook.trim().length > 0;

  const tryValidate = (raw: unknown) =>
    validateAiShadowOutput(raw, {
      hasVendorPlaybook,
      parserFormatId: input.parserFormatId,
    });

  let liteRaw: unknown;
  try {
    liteRaw = await callLiteExtract(input.extractedText, playbook);
  } catch (err) {
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

  let flashParse: unknown = liteRaw;
  let flashVal = liteVal;
  let validatorVerdict: "pass" | "fail" | undefined;
  let validatorError: string | undefined;

  try {
    const validatorRaw = await callFlashValidator(
      input.extractedText,
      playbook,
      liteRaw,
    );
    const unwrapped = unwrapValidator(validatorRaw);
    flashParse = unwrapped.parse;
    flashVal = tryValidate(flashParse);
    validatorVerdict = unwrapped.verdict;
  } catch (err) {
    // 3.6 failed — fall back to Lite for chosen metrics; still record that validate was attempted.
    validatorError = err instanceof Error ? err.message : "validator_failed";
    flashParse = liteRaw;
    flashVal = {
      ok: false,
      failures: ["json_schema_failure"],
    };
  }

  const picked = pickFinal({ liteVal, flashVal, liteRaw, flashParse });
  const out = picked.chosen as AiShadowModelOutput;
  const bothFailed = !liteVal.ok && !flashVal.ok;

  return {
    enabled: true,
    ranAt,
    vendorKey,
    finalModel: picked.finalModel,
    escalated: !liteVal.ok,
    validatedBy: MODEL_FLASH,
    gateFailures: picked.gateFailures,
    liteGateFailures: liteVal.failures,
    validatorGateFailures: flashVal.failures,
    ...(validatorVerdict ? { validatorVerdict } : {}),
    qtyMatchRegex: qtyLinesMatchRegex(out, input.regexLines),
    ...(validatorError
      ? { error: validatorError.slice(0, 240) }
      : bothFailed
        ? { error: "gates_failed_after_validate" }
        : {}),
  };
}

export async function isInvoiceAiShadowEnabled(db: Firestore): Promise<boolean> {
  const snap = await db.collection("appSettings").doc("config").get();
  return snap.exists && snap.data()?.invoiceAiShadowEnabled === true;
}
