/**
 * Lane C C1/C2 — optional in-browser chat store for verify / undeployed rules.
 * Production path uses Firestore subscribe + reviewAgentTurn / apply CFs.
 */
import type {
  ApplyInvoiceReviewFieldCorrectionResult,
  InvoiceReviewChatCitation,
  InvoiceReviewChatMessage,
  InvoiceReviewProposedCorrection,
  ReviewAgentTurnResult,
} from "../models";

const MOCK_FLAG = "__STAGEVERIFY_REVIEW_CHAT_MOCK__";
const STORAGE_PREFIX = "stageverify-review-chat:";
const HEADER_PREFIX = "stageverify-review-chat-header:";

type Listener = (messages: InvoiceReviewChatMessage[]) => void;

type MockApi = {
  enabled: true;
  getMessages: (importId: string) => InvoiceReviewChatMessage[];
  setMessages: (importId: string, messages: InvoiceReviewChatMessage[]) => void;
  getParsedHeader: (importId: string) => Record<string, unknown>;
  setParsedHeader: (
    importId: string,
    header: Record<string, unknown>,
  ) => void;
  appendTurn: (
    importId: string,
    dispatcherText: string,
    agent: InvoiceReviewChatMessage,
    extras?: Partial<
      Pick<
        ReviewAgentTurnResult,
        "autoApplyEligible" | "autoApplyMessageId" | "autoApplyTriggerMode"
      >
    >,
  ) => ReviewAgentTurnResult;
  subscribe: (importId: string, cb: Listener) => () => void;
};

function storageKey(importId: string): string {
  return `${STORAGE_PREFIX}${importId}`;
}

function headerKey(importId: string): string {
  return `${HEADER_PREFIX}${importId}`;
}

function readStored(importId: string): InvoiceReviewChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(importId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as InvoiceReviewChatMessage[])
      : [];
  } catch {
    return [];
  }
}

function writeStored(importId: string, messages: InvoiceReviewChatMessage[]) {
  try {
    sessionStorage.setItem(storageKey(importId), JSON.stringify(messages));
  } catch {
    /* ignore quota */
  }
}

function readHeader(importId: string): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(headerKey(importId));
    if (!raw) {
      return {
        vendorInvoiceNumber: "6168733",
        customerPoOrReference: "",
        vendorOrderNumber: "SO9",
      };
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {
          vendorInvoiceNumber: "6168733",
          customerPoOrReference: "",
          vendorOrderNumber: "SO9",
        };
  } catch {
    return {
      vendorInvoiceNumber: "6168733",
      customerPoOrReference: "",
      vendorOrderNumber: "SO9",
    };
  }
}

function writeHeader(importId: string, header: Record<string, unknown>) {
  try {
    sessionStorage.setItem(headerKey(importId), JSON.stringify(header));
  } catch {
    /* ignore */
  }
}

const listeners = new Map<string, Set<Listener>>();

function notify(importId: string) {
  const msgs = readStored(importId);
  const set = listeners.get(importId);
  if (!set) return;
  for (const cb of set) cb(msgs);
}

function isConfirmation(text: string): boolean {
  return /\b(yes|apply( it)?|use that|that'?s (the )?right|fix it)\b/i.test(
    text,
  );
}

function isDirectPoCommand(text: string): boolean {
  return /\b(update|set|change|correct|fix|capture)\b[\s\S]{0,80}?\b(to|as)\s*[“"']?2205\s+EARLY/i.test(
    text,
  );
}

function buildPoProposal(
  currentValue: string,
): InvoiceReviewProposedCorrection {
  return {
    field: "customerPoOrReference",
    currentValue,
    proposedValue: "2205 EARLY",
    sourceType: "document_evidence",
  };
}

function buildAgentReply(
  dispatcherText: string,
  importId: string,
  prior: InvoiceReviewChatMessage[],
): {
  agent: InvoiceReviewChatMessage;
  autoApplyEligible?: boolean;
  autoApplyMessageId?: string;
  autoApplyTriggerMode?: "chat_direct_command" | "chat_confirmation";
} {
  const upper = dispatcherText.toUpperCase();
  const header = readHeader(importId);
  const currentPo =
    typeof header.customerPoOrReference === "string"
      ? header.customerPoOrReference
      : "";

  const pendingAll = [...prior]
    .reverse()
    .filter(
      (m) =>
        m.role === "agent" &&
        m.correctionStatus === "proposed" &&
        Boolean(m.proposedCorrection),
    );
  // Ambiguity safety: vague confirmation only when exactly one pending proposal.
  const pending = pendingAll.length === 1 ? pendingAll[0] : undefined;

  if (isDirectPoCommand(dispatcherText)) {
    const proposed = buildPoProposal(currentPo);
    const id = `agent-${Date.now()}`;
    return {
      agent: {
        id,
        role: "agent",
        text: `I found “2205 EARLY” in the Customer P/O field. The current parsed value is ${currentPo || "blank"}. I can update Customer PO to 2205 EARLY.`,
        createdAt: new Date().toISOString(),
        createdByUid: "system",
        actionType: "suggest_correction_may_be_needed",
        modelUsed: "gemini-3.5-flash-lite",
        proposedCorrection: proposed,
        correctionStatus: "proposed",
        citations: [
          {
            sourceType: "document_evidence",
            text: "2205 EARLY",
            spanStart: 46,
            spanEnd: 56,
          },
          {
            sourceType: "parser_value",
            text: currentPo || "(empty)",
            field: "parsedHeader.customerPoOrReference",
          },
        ],
      },
      autoApplyEligible: true,
      autoApplyMessageId: id,
      autoApplyTriggerMode: "chat_direct_command",
    };
  }

  if (isConfirmation(dispatcherText) && pending?.proposedCorrection) {
    return {
      agent: {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: `Confirmed. Applying Customer PO → ${pending.proposedCorrection.proposedValue}.`,
        createdAt: new Date().toISOString(),
        createdByUid: "system",
        actionType: "answer",
        modelUsed: "gemini-3.5-flash-lite",
        citations: [
          {
            sourceType: "dispatcher_assertion",
            text: dispatcherText.trim().slice(0, 120),
          },
        ],
      },
      autoApplyEligible: true,
      autoApplyMessageId: pending.id,
      autoApplyTriggerMode: "chat_confirmation",
    };
  }

  const looksLikePo =
    upper.includes("2205 EARLY") ||
    (upper.includes("PO") && (upper.includes("CHECK") || upper.includes("CAPTURE")));

  if (looksLikePo) {
    const proposed = buildPoProposal(currentPo);
    const citations: InvoiceReviewChatCitation[] = [
      {
        sourceType: "document_evidence",
        text: "2205 EARLY",
        spanStart: 46,
        spanEnd: 56,
      },
      {
        sourceType: "parser_value",
        text: currentPo || "(empty)",
        field: "parsedHeader.customerPoOrReference",
      },
    ];
    return {
      agent: {
        id: `agent-${Date.now()}`,
        role: "agent",
        text:
          'I found “2205 EARLY” in the invoice evidence near CUSTOMER P/O. The current parser value for customerPoOrReference is empty, so the parser missed it. I can update Customer PO to 2205 EARLY — use Apply correction or reply “Yes, apply it.”',
        createdAt: new Date().toISOString(),
        createdByUid: "system",
        actionType: "suggest_correction_may_be_needed",
        modelUsed: "gemini-3.5-flash-lite",
        citations,
        proposedCorrection: proposed,
        correctionStatus: "proposed",
      },
    };
  }

  return {
    agent: {
      id: `agent-${Date.now()}`,
      role: "agent",
      text:
        "I checked the parsed fields and invoice evidence windows for this import. Ask about a specific field (PO, order #, or a warning) for a tighter answer.",
      createdAt: new Date().toISOString(),
      createdByUid: "system",
      actionType: "answer",
      modelUsed: "gemini-3.5-flash-lite",
      citations: [
        {
          sourceType: "agent_interpretation",
          text: "General review reply (mock verify path)",
        },
      ],
    },
  };
}

function ensureMock(): MockApi {
  const w = window as Window & { [MOCK_FLAG]?: MockApi };
  if (w[MOCK_FLAG]?.enabled) return w[MOCK_FLAG];

  const api: MockApi = {
    enabled: true,
    getMessages: readStored,
    setMessages: (importId, messages) => {
      writeStored(importId, messages);
      notify(importId);
    },
    getParsedHeader: readHeader,
    setParsedHeader: writeHeader,
    appendTurn: (importId, dispatcherText, agent, extras) => {
      const prior = readStored(importId);
      const dispatcherMsg: InvoiceReviewChatMessage = {
        id: `dispatcher-${Date.now()}`,
        role: "dispatcher",
        text: dispatcherText,
        createdAt: new Date().toISOString(),
        createdByUid: "mock-dispatcher",
      };
      const next = [...prior, dispatcherMsg, agent];
      writeStored(importId, next);
      notify(importId);
      return {
        messageId: agent.id,
        agentMessage: agent,
        ...(extras?.autoApplyEligible
          ? {
              autoApplyEligible: true,
              autoApplyMessageId: extras.autoApplyMessageId,
              autoApplyTriggerMode: extras.autoApplyTriggerMode,
            }
          : {}),
      };
    },
    subscribe: (importId, cb) => {
      let set = listeners.get(importId);
      if (!set) {
        set = new Set();
        listeners.set(importId, set);
      }
      set.add(cb);
      cb(readStored(importId));
      const onStorage = (ev: StorageEvent) => {
        if (ev.key === storageKey(importId)) cb(readStored(importId));
      };
      window.addEventListener("storage", onStorage);
      return () => {
        set?.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
  };

  w[MOCK_FLAG] = api;
  return api;
}

export function isReviewChatMockEnabled(): boolean {
  try {
    if (sessionStorage.getItem("stageverify-review-chat-mock") === "1") {
      ensureMock();
      return true;
    }
  } catch {
    /* ignore */
  }
  const w = window as Window & { [MOCK_FLAG]?: MockApi };
  return Boolean(w[MOCK_FLAG]?.enabled);
}

export function enableReviewChatMock(): void {
  try {
    sessionStorage.setItem("stageverify-review-chat-mock", "1");
  } catch {
    /* ignore */
  }
  ensureMock();
}

export function subscribeReviewChatMock(
  importId: string,
  onChange: Listener,
): () => void {
  return ensureMock().subscribe(importId, onChange);
}

export async function reviewAgentTurnMock(input: {
  vendorInvoiceImportId: string;
  message: string;
}): Promise<ReviewAgentTurnResult> {
  const api = ensureMock();
  await new Promise((r) => setTimeout(r, 350));
  const prior = api.getMessages(input.vendorInvoiceImportId);
  const built = buildAgentReply(
    input.message,
    input.vendorInvoiceImportId,
    prior,
  );
  return api.appendTurn(
    input.vendorInvoiceImportId,
    input.message,
    built.agent,
    {
      autoApplyEligible: built.autoApplyEligible,
      autoApplyMessageId: built.autoApplyMessageId,
      autoApplyTriggerMode: built.autoApplyTriggerMode,
    },
  );
}

export async function applyInvoiceReviewFieldCorrectionMock(input: {
  vendorInvoiceImportId: string;
  sourceMessageId: string;
  idempotencyKey: string;
  triggerMode?: "apply_button" | "chat_direct_command" | "chat_confirmation";
}): Promise<ApplyInvoiceReviewFieldCorrectionResult> {
  const api = ensureMock();
  await new Promise((r) => setTimeout(r, 200));
  const messages = api.getMessages(input.vendorInvoiceImportId);
  const source = messages.find((m) => m.id === input.sourceMessageId);
  if (!source?.proposedCorrection) {
    throw new Error("Message has no valid proposedCorrection.");
  }
  const pc = source.proposedCorrection;
  const header = { ...api.getParsedHeader(input.vendorInvoiceImportId) };
  const live =
    typeof header[pc.field] === "string" ? String(header[pc.field]) : "";
  const correctionId = `${input.vendorInvoiceImportId}__${pc.field}__${input.sourceMessageId}`;

  const nextHeader = { ...header, [pc.field]: pc.proposedValue };
  // Return only the corrected field patch — FE merges into the live import header.
  const parsedHeaderPatch = { [pc.field]: pc.proposedValue };
  // Mock reconcile: clear the resolved missing-field warning for the corrected field.
  const parseWarnings: string[] = [];
  const reviewRequiredReasons: string[] = [];
  const autoImportReasons = [
    pc.field === "customerPoOrReference"
      ? "Customer P/O present"
      : `${pc.field} present`,
  ];

  if (source.correctionStatus === "applied" || live === pc.proposedValue) {
    return {
      vendorInvoiceImportId: input.vendorInvoiceImportId,
      field: pc.field,
      previousValue: pc.currentValue,
      newValue: pc.proposedValue,
      applied: false,
      alreadyApplied: true,
      correctionId,
      parsedHeader: parsedHeaderPatch,
      reviewStatus: "pending_review",
      parseWarnings,
      autoImportEligible: false,
      autoImportConfidence: 0,
      autoImportReasons,
      reviewRequiredReasons,
      importDecisionMode: "review_required",
      suggestedAction: "Review required — inspect fields and match before approve.",
    };
  }

  if (live !== pc.currentValue) {
    throw new Error("expected_current_value_stale");
  }

  api.setParsedHeader(input.vendorInvoiceImportId, nextHeader);

  const next = messages.map((m) =>
    m.id === input.sourceMessageId
      ? { ...m, correctionStatus: "applied" as const }
      : m,
  );
  next.push({
    id: `agent-applied-${Date.now()}`,
    role: "agent",
    text: `Applied. Customer PO changed from ${pc.currentValue || "blank"} to ${pc.proposedValue}.`,
    createdAt: new Date().toISOString(),
    createdByUid: "system",
    actionType: "answer",
  });
  api.setMessages(input.vendorInvoiceImportId, next);

  return {
    vendorInvoiceImportId: input.vendorInvoiceImportId,
    field: pc.field,
    previousValue: pc.currentValue,
    newValue: pc.proposedValue,
    applied: true,
    alreadyApplied: false,
    correctionId,
    parsedHeader: parsedHeaderPatch,
    reviewStatus: "pending_review",
    parseWarnings,
    autoImportEligible: false,
    autoImportConfidence: 0,
    autoImportReasons,
    reviewRequiredReasons,
    importDecisionMode: "review_required",
    suggestedAction: "Review required — inspect fields and match before approve.",
  };
}

/** Seed filler messages so scroll/history can be demonstrated in verify. */
export function seedReviewChatMockHistory(
  importId: string,
  count = 8,
): void {
  const api = ensureMock();
  const existing = api.getMessages(importId);
  const msgs: InvoiceReviewChatMessage[] = [...existing];
  for (let i = 1; i <= count; i += 1) {
    msgs.push({
      id: `seed-d-${i}-${Date.now()}`,
      role: "dispatcher",
      text: `Seed dispatcher message ${i} — checking invoice details.`,
      createdAt: new Date(Date.now() - (count - i) * 60_000).toISOString(),
      createdByUid: "mock-dispatcher",
    });
    msgs.push({
      id: `seed-a-${i}-${Date.now()}`,
      role: "agent",
      text: `Seed agent reply ${i} — reviewed parsed fields and evidence windows.`,
      createdAt: new Date(Date.now() - (count - i) * 60_000 + 1000).toISOString(),
      createdByUid: "system",
      actionType: "answer",
      citations: [
        {
          sourceType: "agent_interpretation",
          text: `seed-${i}`,
        },
      ],
    });
  }
  api.setMessages(importId, msgs);
}

if (typeof window !== "undefined") {
  (
    window as Window & {
      __stageverifySeedReviewChatMockHistory?: typeof seedReviewChatMockHistory;
    }
  ).__stageverifySeedReviewChatMockHistory = seedReviewChatMockHistory;
}
