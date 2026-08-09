/**
 * Lane C C1 — optional in-browser chat store for verify / undeployed rules.
 * Production path uses Firestore subscribe + reviewAgentTurn CF.
 * When mock is enabled (Playwright), messages persist in sessionStorage and
 * reviewAgentTurn is answered with the production response schema.
 */
import type {
  InvoiceReviewChatCitation,
  InvoiceReviewChatMessage,
  ReviewAgentTurnResult,
} from "../models";

const MOCK_FLAG = "__STAGEVERIFY_REVIEW_CHAT_MOCK__";
const STORAGE_PREFIX = "stageverify-review-chat:";

type Listener = (messages: InvoiceReviewChatMessage[]) => void;

type MockApi = {
  enabled: true;
  getMessages: (importId: string) => InvoiceReviewChatMessage[];
  setMessages: (importId: string, messages: InvoiceReviewChatMessage[]) => void;
  appendTurn: (
    importId: string,
    dispatcherText: string,
    agent: InvoiceReviewChatMessage,
  ) => ReviewAgentTurnResult;
  subscribe: (importId: string, cb: Listener) => () => void;
};

function storageKey(importId: string): string {
  return `${STORAGE_PREFIX}${importId}`;
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

const listeners = new Map<string, Set<Listener>>();

function notify(importId: string) {
  const msgs = readStored(importId);
  const set = listeners.get(importId);
  if (!set) return;
  for (const cb of set) cb(msgs);
}

function buildAgentReply(dispatcherText: string): InvoiceReviewChatMessage {
  const upper = dispatcherText.toUpperCase();
  const looksLikePo =
    upper.includes("2205 EARLY") ||
    (upper.includes("PO") && upper.includes("CHECK"));

  if (looksLikePo && upper.includes("2205 EARLY")) {
    const citations: InvoiceReviewChatCitation[] = [
      {
        sourceType: "document_evidence",
        text: "2205 EARLY",
        spanStart: 46,
        spanEnd: 56,
      },
      {
        sourceType: "parser_value",
        text: "(empty)",
        field: "parsedHeader.customerPoOrReference",
      },
    ];
    return {
      id: `agent-${Date.now()}`,
      role: "agent",
      text:
        'I found “2205 EARLY” in the invoice evidence near CUSTOMER P/O. The current parser value for customerPoOrReference is empty, so the parser missed it.',
      createdAt: new Date().toISOString(),
      createdByUid: "system",
      actionType: "identify_mismatch",
      modelUsed: "gemini-3.5-flash-lite",
      citations,
    };
  }

  if (upper.includes("YES") && upper.includes("PO")) {
    return {
      id: `agent-${Date.now()}`,
      role: "agent",
      text:
        "Understood — treating that as your confirmation that 2205 EARLY is the customer PO. I can only explain in this chat; I cannot change the parsed field.",
      createdAt: new Date().toISOString(),
      createdByUid: "system",
      actionType: "answer",
      modelUsed: "gemini-3.5-flash-lite",
      citations: [
        {
          sourceType: "dispatcher_assertion",
          text: dispatcherText.trim().slice(0, 120),
        },
        {
          sourceType: "document_evidence",
          text: "CUSTOMER P/O",
          spanStart: 33,
          spanEnd: 45,
        },
      ],
    };
  }

  return {
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
    appendTurn: (importId, dispatcherText, agent) => {
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
  // Simulate network latency so loading state is visible.
  await new Promise((r) => setTimeout(r, 350));
  const agent = buildAgentReply(input.message);
  return api.appendTurn(input.vendorInvoiceImportId, input.message, agent);
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

// Playwright evaluate helper (no Vite path imports required).
if (typeof window !== "undefined") {
  (
    window as Window & {
      __stageverifySeedReviewChatMockHistory?: typeof seedReviewChatMockHistory;
    }
  ).__stageverifySeedReviewChatMockHistory = seedReviewChatMockHistory;
}
