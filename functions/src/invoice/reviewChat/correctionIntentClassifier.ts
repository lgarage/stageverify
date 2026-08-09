/**
 * Lane C C2 — deterministic correction-intent classifier (no LLM / Firestore).
 */
import {
  normalizeFieldAlias,
  type InvoiceCorrectableFieldKey,
} from "./correctionAllowlist";

export type CorrectionIntentKind = "none" | "direct_command" | "confirmation";

export interface CorrectionIntent {
  kind: CorrectionIntentKind;
  field?: InvoiceCorrectableFieldKey;
  proposedValue?: string;
}

const CONFIRMATION_RE =
  /^\s*(yes|yep|yeah|yup|ok|okay|correct|confirmed?|do it|go ahead|please do|sounds? right|that'?s (right|correct|it)|apply( it)?|use (that|it)|fix it)\b[\s.!,]*$/i;

const CONFIRMATION_SOFT_RE =
  /\b((yes|yep|yeah|ok|okay)[, ]+)?(use that|apply( it)?|that'?s (the )?right|fix it|go ahead and (apply|fix|update))\b/i;

const DIRECT_VALUE_RE =
  /\b(?:update|set|change|correct|fix|capture)\b[\s\S]{0,80}?\b(?:to|as|=|:)\s*[“"']?([A-Z0-9][A-Z0-9 ./-]{0,60}?)[”"']?(?:\s*[.!?]|\s*$)/i;

const FIELD_PHRASE_RE =
  /\b(customer\s*p\.?\/?o\.?|customer\s*po|p\.?\/?o\.?(?:\s*#|\s*number)?|po(?:\s*#|\s*number)?|vendor\s*order(?:\s*#|\s*number)?|order(?:\s*#|\s*number)|invoice(?:\s*#|\s*number)?|so)\b/i;

function extractFieldAlias(message: string): InvoiceCorrectableFieldKey | null {
  const m = message.match(FIELD_PHRASE_RE);
  if (!m?.[1]) return null;
  return normalizeFieldAlias(m[1]);
}

/**
 * Classify dispatcher message for correction auto-apply eligibility.
 * Propose path never mutates — this only informs FE/RPC autoApplyEligible.
 */
export function classifyCorrectionIntent(message: string): CorrectionIntent {
  const text = message.trim();
  if (!text) return { kind: "none" };

  const direct = text.match(DIRECT_VALUE_RE);
  if (direct?.[1]) {
    const proposedValue = direct[1].trim().replace(/[“”"']/g, "");
    const field = extractFieldAlias(text);
    if (field && proposedValue) {
      return { kind: "direct_command", field, proposedValue };
    }
  }

  if (CONFIRMATION_RE.test(text) || CONFIRMATION_SOFT_RE.test(text)) {
    const field = extractFieldAlias(text) ?? undefined;
    return { kind: "confirmation", ...(field ? { field } : {}) };
  }

  return { kind: "none" };
}
