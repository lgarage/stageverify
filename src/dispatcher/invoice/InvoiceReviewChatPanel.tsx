/**
 * Lane C C1/C2 — Invoice Review Chat.
 * Persistent per-import thread; C2 may propose + apply current-import field corrections.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAdminAppearance } from "../../adminAppearance";
import {
  applyInvoiceReviewFieldCorrection,
  reviewAgentTurn,
  subscribeInvoiceReviewChatMessages,
} from "../firestoreService";
import type {
  InvoiceCorrectableFieldKey,
  InvoiceReviewChatMessage,
} from "../models";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const FIELD_LABEL: Record<InvoiceCorrectableFieldKey, string> = {
  customerPoOrReference: "Customer PO",
  vendorOrderNumber: "Vendor order #",
  vendorInvoiceNumber: "Invoice #",
};

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

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function InvoiceReviewChatPanel({
  importId,
  readOnly,
  onCorrectionApplied,
}: {
  importId: string;
  readOnly?: boolean;
  onCorrectionApplied?: (parsedHeader: Record<string, unknown>) => void;
}) {
  const { appearance } = useAdminAppearance();
  const [messages, setMessages] = useState<InvoiceReviewChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(
    null,
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const [localAppliedIds, setLocalAppliedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const autoApplyInFlight = useRef<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    setMessages([]);
    setLocalAppliedIds(new Set());
    setApplyError(null);
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
  }, [messages, sending, applyingMessageId]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 48;
  }

  async function runApply(input: {
    sourceMessageId: string;
    triggerMode: "apply_button" | "chat_direct_command" | "chat_confirmation";
  }) {
    if (readOnly) return;
    if (autoApplyInFlight.current === input.sourceMessageId) return;
    autoApplyInFlight.current = input.sourceMessageId;
    setApplyingMessageId(input.sourceMessageId);
    setApplyError(null);
    try {
      const result = await applyInvoiceReviewFieldCorrection({
        vendorInvoiceImportId: importId,
        sourceMessageId: input.sourceMessageId,
        idempotencyKey: newIdempotencyKey(),
        triggerMode: input.triggerMode,
      });
      setLocalAppliedIds((prev) => {
        const next = new Set(prev);
        next.add(input.sourceMessageId);
        return next;
      });
      onCorrectionApplied?.(result.parsedHeader);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not apply the correction right now.";
      setApplyError(msg);
    } finally {
      if (autoApplyInFlight.current === input.sourceMessageId) {
        autoApplyInFlight.current = null;
      }
      setApplyingMessageId((cur) =>
        cur === input.sourceMessageId ? null : cur,
      );
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending || readOnly) return;
    setSending(true);
    setSendError(null);
    setApplyError(null);
    stickToBottomRef.current = true;
    setDraft("");
    try {
      const turn = await reviewAgentTurn({
        vendorInvoiceImportId: importId,
        message: text,
      });
      if (
        turn.autoApplyEligible &&
        turn.autoApplyMessageId &&
        turn.autoApplyTriggerMode
      ) {
        await runApply({
          sourceMessageId: turn.autoApplyMessageId,
          triggerMode: turn.autoApplyTriggerMode,
        });
      }
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
          Ask about this invoice. The agent can propose safe field corrections
          for this import only — never invoice Approve/Reject.
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
          const pc = m.proposedCorrection;
          const isProposed =
            Boolean(pc) &&
            m.correctionStatus === "proposed" &&
            !localAppliedIds.has(m.id);
          const isApplied =
            Boolean(pc) &&
            (m.correctionStatus === "applied" || localAppliedIds.has(m.id));
          const applying = applyingMessageId === m.id;

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

              {pc && isProposed && (
                <div
                  data-testid="invoice-review-chat-correction-card"
                  style={{
                    marginTop: 2,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--admin-border)",
                    backgroundColor: "var(--admin-surface-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--admin-text-label)",
                    }}
                  >
                    Proposed correction
                  </div>
                  <div
                    data-testid="invoice-review-chat-correction-summary"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--admin-text-data)",
                      lineHeight: 1.4,
                    }}
                  >
                    {FIELD_LABEL[pc.field]}
                    <br />
                    <span style={{ color: "var(--admin-text-secondary)" }}>
                      {pc.currentValue || "Blank"}
                    </span>
                    {" → "}
                    <span>{pc.proposedValue}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--admin-text-muted)",
                    }}
                  >
                    Source:{" "}
                    {pc.sourceType === "document_evidence"
                      ? "Document evidence"
                      : pc.sourceType === "dispatcher_assertion"
                        ? "Your message"
                        : "Needs confirmation"}
                  </div>
                  <button
                    type="button"
                    data-testid="invoice-review-chat-apply-correction"
                    disabled={applying || Boolean(readOnly)}
                    onClick={() =>
                      void runApply({
                        sourceMessageId: m.id,
                        triggerMode: "apply_button",
                      })
                    }
                    style={{
                      alignSelf: "flex-start",
                      height: 34,
                      padding: "0 14px",
                      borderRadius: 8,
                      border: "1px solid var(--admin-border)",
                      backgroundColor: "var(--admin-surface)",
                      color: "var(--admin-text-data)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor:
                        applying || Boolean(readOnly)
                          ? "not-allowed"
                          : "pointer",
                      opacity: applying || Boolean(readOnly) ? 0.55 : 1,
                      fontFamily: FONT,
                    }}
                  >
                    {applying ? "Applying…" : "Apply correction"}
                  </button>
                  {applying && (
                    <div
                      data-testid="invoice-review-chat-applying"
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--admin-text-secondary)",
                      }}
                    >
                      Applying correction…
                    </div>
                  )}
                </div>
              )}

              {pc && isApplied && (
                <div
                  data-testid="invoice-review-chat-correction-applied"
                  style={{
                    marginTop: 2,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--admin-success-border, var(--admin-border))",
                    backgroundColor: "var(--admin-success-bg)",
                    color: "var(--admin-success-text)",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.4,
                  }}
                >
                  Applied — {FIELD_LABEL[pc.field]}: {pc.proposedValue}
                </div>
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

        {applyingMessageId && !sending && (
          <div
            data-testid="invoice-review-chat-auto-applying"
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
            Applying confirmed correction…
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
        {(sendError || applyError) && (
          <div
            data-testid={
              applyError
                ? "invoice-review-chat-apply-error"
                : "invoice-review-chat-send-error"
            }
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
            {applyError || sendError}
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
            placeholder='Example: Reparse it and capture that PO.'
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
