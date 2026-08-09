/**
 * Lane C C1 — Invoice Review Chat (read/explain only).
 * Persistent per-import thread; no field mutation / ignore / approve side effects.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAdminAppearance } from "../../adminAppearance";
import {
  reviewAgentTurn,
  subscribeInvoiceReviewChatMessages,
} from "../firestoreService";
import type { InvoiceReviewChatMessage } from "../models";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function citationLabel(sourceType: string): string {
  switch (sourceType) {
    case "document_evidence":
      return "Document evidence";
    case "parser_value":
      return "Parser value";
    case "dispatcher_assertion":
      return "Dispatcher assertion";
    case "agent_interpretation":
      return "Agent interpretation";
    default:
      return sourceType;
  }
}

export function InvoiceReviewChatPanel({
  importId,
  readOnly,
}: {
  importId: string;
  readOnly?: boolean;
}) {
  const { appearance } = useAdminAppearance();
  const [messages, setMessages] = useState<InvoiceReviewChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    setLoadError(null);
    setMessages([]);
    const unsub = subscribeInvoiceReviewChatMessages(
      importId,
      (next) => {
        setMessages(next);
        setLoadError(null);
      },
      (err) => {
        const raw = err.message || "Could not load chat history.";
        if (/insufficient permissions|permission-denied/i.test(raw)) {
          setLoadError(
            "Chat history unavailable until Invoice Review Chat rules are deployed.",
          );
        } else {
          setLoadError(raw);
        }
      },
    );
    return unsub;
  }, [importId]);

  useEffect(() => {
    if (!stickToBottomRef.current || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 48;
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending || readOnly) return;
    setSending(true);
    setSendError(null);
    stickToBottomRef.current = true;
    setDraft("");
    try {
      await reviewAgentTurn({
        vendorInvoiceImportId: importId,
        message: text,
      });
    } catch (err) {
      setDraft(text);
      const msg =
        err instanceof Error
          ? err.message
          : "Invoice Review Chat is temporarily unavailable.";
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <section
      data-testid="invoice-review-chat-panel"
      data-admin-appearance={appearance}
      data-theme-appearance={appearance}
      style={{
        margin: "0 0 20px",
        border: "1px solid var(--admin-border)",
        borderRadius: 10,
        backgroundColor: "var(--admin-surface-2)",
        display: "flex",
        flexDirection: "column",
        minHeight: 280,
        maxHeight: 420,
        fontFamily: FONT,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--admin-border)",
        }}
      >
        <h3
          data-testid="invoice-review-chat-title"
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            color: "var(--admin-text-data)",
          }}
        >
          Invoice Review Chat
        </h3>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--admin-text-secondary)",
            fontWeight: 500,
          }}
        >
          Ask about this invoice. The agent re-checks parsed fields and invoice
          evidence. It cannot approve, reject, or change fields.
        </p>
      </header>

      <div
        ref={listRef}
        data-testid="invoice-review-chat-history"
        onScroll={onListScroll}
        style={{
          flex: 1,
          minHeight: 160,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          backgroundColor: "var(--admin-surface)",
        }}
      >
        {loadError && (
          <div
            data-testid="invoice-review-chat-load-error"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--admin-danger-border)",
              backgroundColor: "var(--admin-danger-bg)",
              color: "var(--admin-danger-text)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {loadError}
          </div>
        )}

        {!loadError && messages.length === 0 && !sending && (
          <div
            data-testid="invoice-review-chat-empty"
            style={{
              margin: "auto 0",
              textAlign: "center",
              color: "var(--admin-text-muted)",
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.45,
              padding: "18px 8px",
            }}
          >
            No messages yet. Ask about a missing PO, order number, or parser
            warning.
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "dispatcher";
          return (
            <div
              key={m.id}
              data-testid={`invoice-review-chat-msg-${m.role}`}
              data-role={m.role}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "92%",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.02,
                  color: "var(--admin-text-muted)",
                  textAlign: isUser ? "right" : "left",
                }}
              >
                {isUser ? "Dispatcher" : "Agent"}
              </div>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--admin-border)",
                  backgroundColor: isUser
                    ? "var(--admin-info-bg)"
                    : "var(--admin-surface-2)",
                  color: isUser
                    ? "var(--admin-info-text)"
                    : "var(--admin-text-data)",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.text}
              </div>
              {m.error && (
                <div
                  data-testid="invoice-review-chat-msg-error"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--admin-danger-text)",
                  }}
                >
                  AI unavailable — fail-closed reply stored.
                </div>
              )}
              {m.citations && m.citations.length > 0 && (
                <ul
                  data-testid="invoice-review-chat-citations"
                  style={{
                    margin: 0,
                    padding: "0 0 0 16px",
                    color: "var(--admin-text-secondary)",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {m.citations.map((c, idx) => (
                    <li key={`${m.id}-c-${idx}`}>
                      <strong style={{ color: "var(--admin-text-label)" }}>
                        {citationLabel(c.sourceType)}
                      </strong>
                      {c.field ? ` (${c.field})` : ""}: “{c.text}”
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {sending && (
          <div
            data-testid="invoice-review-chat-thinking"
            style={{
              alignSelf: "flex-start",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px dashed var(--admin-border)",
              color: "var(--admin-text-secondary)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Agent is checking the invoice…
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--admin-border)",
          padding: "10px 12px 12px",
          backgroundColor: "var(--admin-surface-2)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {sendError && (
          <div
            data-testid="invoice-review-chat-send-error"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--admin-danger-border)",
              backgroundColor: "var(--admin-danger-bg)",
              color: "var(--admin-danger-text)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {sendError}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            data-testid="invoice-review-chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={sending || Boolean(readOnly)}
            placeholder='Example: I see the PO and it is 2205 EARLY. Check the invoice again.'
            style={{
              flex: 1,
              boxSizing: "border-box",
              resize: "vertical",
              minHeight: 52,
              maxHeight: 120,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.45,
              color: "var(--admin-text-data)",
              backgroundColor: "var(--admin-surface)",
              border: "1px solid var(--admin-border)",
              borderRadius: 8,
              padding: "10px 12px",
              fontFamily: FONT,
            }}
          />
          <button
            type="button"
            data-testid="invoice-review-chat-send"
            disabled={sending || Boolean(readOnly) || !draft.trim()}
            onClick={() => void handleSend()}
            style={{
              flexShrink: 0,
              height: 40,
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "var(--admin-navy, #0a3161)",
              color: "var(--admin-on-navy, #fff)",
              fontSize: 13,
              fontWeight: 700,
              cursor:
                sending || Boolean(readOnly) || !draft.trim()
                  ? "not-allowed"
                  : "pointer",
              opacity: sending || Boolean(readOnly) || !draft.trim() ? 0.55 : 1,
              fontFamily: FONT,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}
