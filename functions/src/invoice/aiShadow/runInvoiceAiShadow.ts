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
  escalated: boolean;
  gateFailures: AiShadowGateId[];
  qtyMatchRegex: boolean | null;
  error?: string;
}

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

async function callModel(
  modelId: typeof MODEL_FLASH_LITE | typeof MODEL_FLASH,
  thinkingLevel: "minimal" | "medium",
  extractText: string,
  playbook: string,
): Promise<unknown> {
  const userText =
    (playbook.trim()
      ? `## Vendor playbook\n${playbook.slice(0, 8000)}\n\n`
      : "") + `## Invoice text\n${extractText}`;
  return vertexGenerateJson({
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

  try {
    const liteRaw = await callModel(
      MODEL_FLASH_LITE,
      "minimal",
      input.extractedText,
      playbook,
    );
    const liteVal = tryValidate(liteRaw);
    if (liteVal.ok) {
      const out = liteRaw as AiShadowModelOutput;
      return {
        enabled: true,
        ranAt,
        vendorKey,
        finalModel: MODEL_FLASH_LITE,
        escalated: false,
        gateFailures: [],
        qtyMatchRegex: qtyLinesMatchRegex(out, input.regexLines),
      };
    }

    const flashRaw = await callModel(
      MODEL_FLASH,
      "medium",
      input.extractedText,
      playbook,
    );
    const flashVal = tryValidate(flashRaw);
    const out = flashVal.ok ? (flashRaw as AiShadowModelOutput) : null;
    return {
      enabled: true,
      ranAt,
      vendorKey,
      finalModel: MODEL_FLASH,
      escalated: true,
      gateFailures: flashVal.ok ? [] : flashVal.failures,
      qtyMatchRegex: out ? qtyLinesMatchRegex(out, input.regexLines) : null,
      ...(flashVal.ok ? {} : { error: "gates_failed_after_escalate" }),
    };
  } catch (err) {
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

export async function isInvoiceAiShadowEnabled(db: Firestore): Promise<boolean> {
  const snap = await db.collection("appSettings").doc("config").get();
  return snap.exists && snap.data()?.invoiceAiShadowEnabled === true;
}
