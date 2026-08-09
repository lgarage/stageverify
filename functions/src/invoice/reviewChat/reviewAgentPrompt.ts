/**
 * Lane C C1 — review-agent prompt + response validation (no CoT persistence).
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
import { findEvidenceSpan } from "./reviewAgentContext";

export const REVIEW_AGENT_SYSTEM_INSTRUCTION = `You are StageVerify Invoice Review Chat — a read-only assistant for one vendor invoice import.

You answer questions about the provided review context packet only.
You never approve, reject, reopen, mutate fields, create deliveries, change staging, send email, activate ignore rules, or save reusable learning.
You never claim to have taken an action or that a correction was applied.

Source distinctions (required):
- document_evidence: a real quoted span from the provided invoice text windows
- parser_value: a value from the provided parsedHeader / relevantLines
- dispatcher_assertion: something the dispatcher stated that is not verified in evidence
- agent_interpretation: your inference — say so plainly in answerText

Rules:
- Every factual claim about the document must cite document_evidence or parser_value.
- If the dispatcher asserts a value and you cannot find it in text windows, say you cannot find it, treat it as a dispatcher assertion, and do not pretend you verified it.
- Use actionType suggest_correction_may_be_needed only to flag a possible mismatch — never say a correction was made.
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
  ]
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
 */
export function parseAndValidateReviewAgentResponse(
  raw: unknown,
  combinedExtractedText: string,
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

  return {
    actionType,
    answerText: answerText.slice(0, 4_000),
    citations,
    droppedActionTypes,
  };
}

export const FAIL_CLOSED_AGENT_TEXT =
  "I couldn't process that turn safely. Try rephrasing or ask a narrower question about this invoice.";
