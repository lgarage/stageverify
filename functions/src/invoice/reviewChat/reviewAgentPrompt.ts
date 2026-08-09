/**
 * Lane C C1/C2 — review-agent prompt + response validation (no CoT persistence).
 * C1: reconciles assertion vs document evidence.
 * C2: may propose a correction; never claims apply / never mutates.
 */
import type { ReviewAgentContextPacket } from "./reviewAgentTypes";
import {
  ALLOWED_REVIEW_ACTION_TYPES,
  CITATION_SOURCE_TYPES,
  type ReviewAgentActionType,
  type ReviewAgentModelResponse,
  type ReviewChatCitation,
  type ReviewCitationSourceType,
} from "./reviewAgentTypes";
import { reconcileAssertionConsistency } from "./assertionSupport";
import { reconcileAuthoritativeCorrectionState } from "./correctionStateGate";
import type { FieldCorrectionLogEntry } from "./reconcileAfterFieldCorrection";
import { findEvidenceSpan } from "./reviewAgentContext";
import { isCorrectableFieldKey } from "./correctionAllowlist";

export const REVIEW_AGENT_SYSTEM_INSTRUCTION = `You are StageVerify Invoice Review Chat for one vendor invoice import.

You answer questions about the provided review context packet only.
You never approve, reject, reopen, create deliveries, change staging, send email, activate ignore rules, or save reusable learning.
You never claim to have already applied a correction or mutated a field before confirmation.

Authoritative truth (required):
- parsedHeader is the CURRENT authoritative header (includes applied C2 corrections).
- originalParsedHeader / originalParseWarnings are HISTORICAL parser snapshots only — never describe them as current.
- fieldCorrectionLog lists applied corrections for this import — honor those current values.
- parseWarnings / reviewIssues are CURRENT unresolved issues only.
- If Customer PO was corrected to a value, say the current PO is that value. Do not say it is still blank/missing.

When the dispatcher asks to capture/fix/update an allowlisted parsed field and you have a clear proposed value:
- Use actionType "suggest_correction_may_be_needed"
- Include proposedCorrection: { field, currentValue, proposedValue }
- field MUST be one of correctableFields from the packet
- Say you can update the field after they confirm (Apply correction / "Yes, apply it")
- Do NOT say you cannot change or apply corrections — C2 can apply after explicit confirmation
- Do NOT say the value was already changed

Source distinctions (required):
- document_evidence: a real quoted span from the provided invoice text windows
- parser_value: a value from the provided parsedHeader / relevantLines
- dispatcher_assertion: something the dispatcher stated that is not verified in evidence
- agent_interpretation: your inference — say so plainly in answerText

Rules:
- Every factual claim about the document must cite document_evidence or parser_value.
- If the dispatcher asserts a value and you cannot find it in text windows, say you cannot find it, treat it as a dispatcher assertion, and do not pretend you verified it.
- If a dispatcher assertion appears as a contiguous substring in the provided text windows or document evidence, treat it as supported — do not say unsupported while citing supporting document_evidence. Still do not invent evidence.
- Never deny document evidence that appears in the provided text windows for a value that is also the current authoritative header value.
- Use actionType suggest_correction_may_be_needed only to flag a possible mismatch or propose an allowlisted correction — never say a correction was made.
- Return ONLY JSON matching the schema. No markdown fences, no extra keys, no reasoning/thinking field.

JSON schema:
{
  "actionType": "answer" | "cite_evidence" | "explain_parser" | "identify_mismatch" | "suggest_correction_may_be_needed",
  "answerText": "string",
  "citations": [
    {
      "sourceType": "document_evidence" | "parser_value" | "dispatcher_assertion" | "agent_interpretation",
      "text": "string",
      "field": "optional dotted path for parser_value"
    }
  ],
  "proposedCorrection": {
    "field": "customerPoOrReference | vendorOrderNumber | vendorInvoiceNumber",
    "currentValue": "string",
    "proposedValue": "string"
  }
}`;

export function formatReviewAgentUserText(
  packet: ReviewAgentContextPacket,
  dispatcherMessage: string,
): string {
  return [
    "## Review context packet",
    JSON.stringify(packet, null, 2),
    "",
    "## Dispatcher message",
    dispatcherMessage,
  ].join("\n");
}

function isAllowedAction(value: unknown): value is ReviewAgentActionType {
  return (
    typeof value === "string" &&
    (ALLOWED_REVIEW_ACTION_TYPES as readonly string[]).includes(value)
  );
}

function isCitationSource(value: unknown): value is ReviewCitationSourceType {
  return (
    typeof value === "string" &&
    (CITATION_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Parse model JSON, drop unknown action types, resolve document_evidence citations.
 * Unresolvable document_evidence citations downgrade to agent_interpretation.
 * Invalid proposedCorrection is dropped (turn still returns answerText).
 * Assertion/evidence contradictions are reconciled deterministically (C1 #72).
 */
export function parseAndValidateReviewAgentResponse(
  raw: unknown,
  combinedExtractedText: string,
  options?: {
    dispatcherMessage?: string;
    parserCustomerPo?: string | null;
    parsedHeader?: unknown;
    fieldCorrectionLog?: FieldCorrectionLogEntry[];
  },
): ReviewAgentModelResponse | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "response_not_object" };
  }
  const obj = raw as Record<string, unknown>;
  const droppedActionTypes: string[] = [];

  let actionType: ReviewAgentActionType = "answer";
  if (isAllowedAction(obj.actionType)) {
    actionType = obj.actionType;
  } else if (typeof obj.actionType === "string" && obj.actionType.trim()) {
    droppedActionTypes.push(obj.actionType.trim());
  }

  const answerText =
    typeof obj.answerText === "string" ? obj.answerText.trim() : "";
  if (!answerText) {
    return { ok: false, reason: "missing_answer_text" };
  }

  const citationsIn = Array.isArray(obj.citations) ? obj.citations : [];
  const citations: ReviewChatCitation[] = [];

  for (const item of citationsIn) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const c = item as Record<string, unknown>;
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (!text) continue;
    let sourceType: ReviewCitationSourceType = isCitationSource(c.sourceType)
      ? c.sourceType
      : "agent_interpretation";
    const field = typeof c.field === "string" ? c.field.trim() : undefined;

    if (sourceType === "document_evidence") {
      const span = findEvidenceSpan(combinedExtractedText, text);
      if (!span) {
        citations.push({
          sourceType: "agent_interpretation",
          text,
          ...(field ? { field } : {}),
        });
        continue;
      }
      citations.push({
        sourceType: "document_evidence",
        text: span.matched,
        spanStart: span.start,
        spanEnd: span.end,
        ...(field ? { field } : {}),
      });
      continue;
    }

    citations.push({
      sourceType,
      text,
      ...(field ? { field } : {}),
    });
  }

  let proposedCorrection: ReviewAgentModelResponse["proposedCorrection"];
  const pcRaw = obj.proposedCorrection;
  if (pcRaw && typeof pcRaw === "object" && !Array.isArray(pcRaw)) {
    const pc = pcRaw as Record<string, unknown>;
    const fieldRaw = typeof pc.field === "string" ? pc.field.trim() : "";
    // Accept dotted path from model: parsedHeader.customerPoOrReference
    const field = fieldRaw.includes(".")
      ? fieldRaw.split(".").pop()!.trim()
      : fieldRaw;
    const proposedValue =
      typeof pc.proposedValue === "string" ? pc.proposedValue.trim() : "";
    const currentValue =
      typeof pc.currentValue === "string" ? pc.currentValue.trim() : "";
    if (isCorrectableFieldKey(field) && proposedValue) {
      proposedCorrection = {
        field,
        ...(currentValue ? { currentValue } : {}),
        proposedValue,
      };
      if (actionType !== "suggest_correction_may_be_needed") {
        actionType = "suggest_correction_may_be_needed";
      }
    }
  }

  let finalActionType = actionType;
  let finalAnswerText = answerText.slice(0, 4_000);
  let finalCitations = citations;
  let consistencyCorrected = false;

  if (options?.dispatcherMessage?.trim()) {
    const reconciled = reconcileAssertionConsistency({
      dispatcherMessage: options.dispatcherMessage,
      answerText: finalAnswerText,
      citations: finalCitations,
      actionType: finalActionType,
      combinedExtractedText,
      parserCustomerPo: options.parserCustomerPo,
    });
    finalActionType = reconciled.actionType;
    finalAnswerText = reconciled.answerText.slice(0, 4_000);
    finalCitations = reconciled.citations;
    consistencyCorrected = reconciled.consistencyCorrected;
  }

  const authoritative = reconcileAuthoritativeCorrectionState({
    answerText: finalAnswerText,
    citations: finalCitations,
    actionType: finalActionType,
    parsedHeader: options?.parsedHeader,
    fieldCorrectionLog: options?.fieldCorrectionLog,
    combinedExtractedText,
  });
  if (authoritative.consistencyCorrected) {
    finalActionType = authoritative.actionType;
    finalAnswerText = authoritative.answerText.slice(0, 4_000);
    finalCitations = authoritative.citations;
    consistencyCorrected = true;
  }

  return {
    actionType: finalActionType,
    answerText: finalAnswerText,
    citations: finalCitations,
    droppedActionTypes,
    ...(consistencyCorrected ? { consistencyCorrected: true } : {}),
    ...(proposedCorrection ? { proposedCorrection } : {}),
  };
}

export const FAIL_CLOSED_AGENT_TEXT =
  "I couldn't process that turn safely. Try rephrasing or ask a narrower question about this invoice.";
