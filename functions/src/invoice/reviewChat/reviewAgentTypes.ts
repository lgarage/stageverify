/**
 * Lane C C1/C2 — Invoice Review Chat types.
 * C1: read/explain + assertion/evidence consistency.
 * C2: propose corrections only (apply is a separate callable).
 */

import type {
  InvoiceCorrectableFieldKey,
  ReviewCorrectionStatus,
  ReviewProposedCorrection,
} from "./correctionAllowlist";

export const REVIEW_CHAT_COLLECTION = "vendorInvoiceImportChats";
export const REVIEW_CHAT_MESSAGES_SUB = "messages";
export const REVIEW_CHAT_RATE_LIMIT_COLLECTION = "invoiceReviewChatRateLimits";

export const ALLOWED_REVIEW_ACTION_TYPES = [
  "answer",
  "cite_evidence",
  "explain_parser",
  "identify_mismatch",
  "suggest_correction_may_be_needed",
] as const;

export type ReviewAgentActionType = (typeof ALLOWED_REVIEW_ACTION_TYPES)[number];

export const CITATION_SOURCE_TYPES = [
  "document_evidence",
  "parser_value",
  "dispatcher_assertion",
  "agent_interpretation",
] as const;

export type ReviewCitationSourceType = (typeof CITATION_SOURCE_TYPES)[number];

export type ReviewChatMessageRole = "dispatcher" | "agent";

export interface ReviewChatCitation {
  sourceType: ReviewCitationSourceType;
  text: string;
  spanStart?: number;
  spanEnd?: number;
  field?: string;
}

export interface ReviewAgentModelResponse {
  actionType: ReviewAgentActionType;
  answerText: string;
  citations: ReviewChatCitation[];
  droppedActionTypes: string[];
  /** Set when deterministic assertion/evidence reconcile rewrote the model answer. */
  consistencyCorrected?: boolean;
  /** Raw model proposal — validated/normalized before persist. */
  proposedCorrection?: {
    field: string;
    currentValue?: string;
    proposedValue: string;
  };
}

export interface ReviewAgentContextPacket {
  parsedHeader: Record<string, unknown>;
  relevantLines: Array<Record<string, unknown>>;
  parseWarnings: string[];
  reviewIssues: string[];
  textWindows: Array<{ start: number; end: number; text: string }>;
  recentTurns: Array<{ role: ReviewChatMessageRole; text: string }>;
  rollingSummary: string;
  sourceTextAvailable: boolean;
  correctableFields: InvoiceCorrectableFieldKey[];
}

export interface ReviewAgentTurnResult {
  messageId: string;
  agentMessage: {
    id: string;
    role: "agent";
    text: string;
    createdAt: string;
    createdByUid: string;
    citations?: ReviewChatCitation[];
    actionType?: ReviewAgentActionType;
    modelUsed?: string;
    droppedActionTypes?: string[];
    error?: string;
    proposedCorrection?: ReviewProposedCorrection;
    correctionStatus?: ReviewCorrectionStatus;
  };
  autoApplyEligible?: boolean;
  autoApplyMessageId?: string;
  autoApplyTriggerMode?: "chat_direct_command" | "chat_confirmation";
}

export type {
  InvoiceCorrectableFieldKey,
  ReviewCorrectionStatus,
  ReviewProposedCorrection,
};
