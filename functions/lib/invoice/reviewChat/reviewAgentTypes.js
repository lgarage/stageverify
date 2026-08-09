"use strict";
/**
 * Lane C C1/C2 — Invoice Review Chat types.
 * C1: read/explain + assertion/evidence consistency.
 * C2: propose corrections only (apply is a separate callable).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CITATION_SOURCE_TYPES = exports.ALLOWED_REVIEW_ACTION_TYPES = exports.REVIEW_CHAT_RATE_LIMIT_COLLECTION = exports.REVIEW_CHAT_MESSAGES_SUB = exports.REVIEW_CHAT_COLLECTION = void 0;
exports.REVIEW_CHAT_COLLECTION = "vendorInvoiceImportChats";
exports.REVIEW_CHAT_MESSAGES_SUB = "messages";
exports.REVIEW_CHAT_RATE_LIMIT_COLLECTION = "invoiceReviewChatRateLimits";
exports.ALLOWED_REVIEW_ACTION_TYPES = [
    "answer",
    "cite_evidence",
    "explain_parser",
    "identify_mismatch",
    "suggest_correction_may_be_needed",
];
exports.CITATION_SOURCE_TYPES = [
    "document_evidence",
    "parser_value",
    "dispatcher_assertion",
    "agent_interpretation",
];
//# sourceMappingURL=reviewAgentTypes.js.map