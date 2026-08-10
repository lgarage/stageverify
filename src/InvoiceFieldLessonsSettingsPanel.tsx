import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  FieldLessonCaptureShapeId,
  FieldLessonDisabledReason,
  FieldLessonLifecycleAction,
  InvoiceCorrectableFieldKey,
  VendorInvoiceFieldLessonListItem,
} from "./dispatcher/models";
import {
  listVendorInvoiceFieldLessons,
  setVendorInvoiceFieldLessonStatus,
} from "./dispatcher/firestoreService";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = "#0a3161";
const TEXT = "var(--admin-text)";
const MUTED = "var(--admin-text-muted)";
const SECONDARY = "var(--admin-text-secondary)";

const FIELD_LABELS: Record<InvoiceCorrectableFieldKey, string> = {
  customerPoOrReference: "Customer PO / Reference",
  vendorOrderNumber: "Sales Order #",
  vendorInvoiceNumber: "Invoice #",
};

const CAPTURE_LABELS: Record<FieldLessonCaptureShapeId, string> = {
  anchor_left_inline: "Value appears beside the label",
  anchor_above_line: "Value appears directly below the label",
};

const SUSPENSION_LABELS: Record<FieldLessonDisabledReason, string> = {
  contradictory_evidence: "Conflicting evidence was found",
  eligible_votes_below_threshold: "Supporting evidence fell below the threshold",
  superseded_by_winning_pattern: "A stronger pattern replaced this lesson",
  manual_suspend: "Suspended for review",
  auto_false_positive: "Automatic false-positive safeguard",
};

const ACTION_LABELS: Record<FieldLessonLifecycleAction, string> = {
  activate: "Activate",
  reject: "Reject",
  suspend: "Suspend",
  reactivate: "Reactivate",
};

const ACTION_EXPLANATIONS: Record<FieldLessonLifecycleAction, string> = {
  activate:
    "Approve this deterministic pattern for future parser application. Parser application is not live yet.",
  reject:
    "Reject this proposed pattern after reviewing its evidence. Rejected lessons cannot be activated.",
  suspend:
    "Pause this active pattern from future parser application while it is reviewed.",
  reactivate:
    "Ask the server to revalidate the current evidence before restoring this lesson to Active.",
};

const primaryButtonStyle: CSSProperties = {
  border: `1px solid ${NAVY}`,
  borderRadius: 7,
  padding: "9px 14px",
  backgroundColor: NAVY,
  color: "var(--admin-on-navy, #fff)",
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--admin-border-strong)",
  borderRadius: 7,
  padding: "9px 14px",
  backgroundColor: "var(--admin-surface-2)",
  color: TEXT,
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const detailLabelStyle: CSSProperties = {
  margin: "0 0 4px",
  color: MUTED,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const detailValueStyle: CSSProperties = {
  margin: 0,
  color: TEXT,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function friendlySuspensionReason(
  reason: FieldLessonDisabledReason | null,
): string {
  return reason ? SUSPENSION_LABELS[reason] : "Reason not provided";
}

function literalAnchor(lesson: VendorInvoiceFieldLessonListItem): string {
  const literals = lesson.extractionPattern.matchedLiteralAnchors.filter(Boolean);
  if (literals.length > 0) return literals.join(" · ");
  const canonical = lesson.extractionPattern.canonicalAnchorKeys.filter(Boolean);
  return canonical.length > 0 ? canonical.join(" · ") : "—";
}

function isVerificationFixture(
  lesson: VendorInvoiceFieldLessonListItem,
): boolean {
  return [lesson.id, lesson.vendorKey].some((value) =>
    /(test|fixture|verify|demo)/i.test(value),
  );
}

function statusAccent(
  lesson: VendorInvoiceFieldLessonListItem,
): string {
  switch (lesson.status) {
    case "proposed":
      return "var(--admin-warning-text)";
    case "active":
      return "var(--admin-success-text)";
    case "suspended":
      return "var(--admin-danger-text)";
    case "rejected":
      return "var(--admin-text-muted)";
  }
}

function LessonDatum({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={detailLabelStyle}>{label}</p>
      <p style={detailValueStyle}>{value}</p>
      {secondary && (
        <p
          style={{
            margin: "3px 0 0",
            color: MUTED,
            fontSize: 11,
            lineHeight: 1.4,
            overflowWrap: "anywhere",
          }}
        >
          {secondary}
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  lesson,
}: {
  lesson: VendorInvoiceFieldLessonListItem;
}) {
  const statusStyle = {
    proposed: {
      border: "var(--admin-warning-border)",
      background: "var(--admin-warning-bg)",
      color: "var(--admin-warning-text)",
      label: "Proposed — awaiting Manager review",
    },
    active: {
      border: "var(--admin-success-border)",
      background: "var(--admin-success-bg)",
      color: "var(--admin-success-text)",
      label: "Active — approved for future parser application.",
    },
    suspended: {
      border: "var(--admin-danger-border)",
      background: "var(--admin-danger-bg)",
      color: "var(--admin-danger-text)",
      label: "Suspended",
    },
    rejected: {
      border: "var(--admin-border-strong)",
      background: "var(--admin-surface-3)",
      color: TEXT,
      label: "Rejected",
    },
  }[lesson.status];

  return (
    <span
      data-testid="invoice-learning-status"
      data-status={lesson.status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 9px",
        borderRadius: 999,
        border: `1px solid ${statusStyle.border}`,
        backgroundColor: statusStyle.background,
        color: statusStyle.color,
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1.3,
      }}
    >
      {statusStyle.label}
    </span>
  );
}

function CountCard({
  label,
  count,
  testId,
  accent,
}: {
  label: string;
  count: number;
  testId: string;
  accent: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "13px 14px",
        border: "1px solid var(--admin-border)",
        borderTop: `3px solid ${accent}`,
        borderRadius: 8,
        backgroundColor: "var(--admin-surface-2)",
      }}
    >
      <div
        style={{
          color: SECONDARY,
          fontSize: 12,
          fontWeight: 700,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div
        data-testid={testId}
        style={{
          color: TEXT,
          fontSize: 24,
          fontWeight: 800,
          lineHeight: 1,
        }}
      >
        {count}
      </div>
    </div>
  );
}

function LessonDetail({
  lesson,
  onClose,
  onAction,
}: {
  lesson: VendorInvoiceFieldLessonListItem;
  onClose: () => void;
  onAction: (
    action: FieldLessonLifecycleAction,
    note?: string,
  ) => Promise<void>;
}) {
  const captureShape = lesson.extractionPattern.captureShapeId;
  const [pendingAction, setPendingAction] =
    useState<FieldLessonLifecycleAction | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasContradiction =
    lesson.disabledReason === "contradictory_evidence";

  useEffect(() => {
    setPendingAction(null);
    setNote("");
    setSubmitting(false);
    setActionError(null);
  }, [lesson.id, lesson.status, lesson.version]);

  const beginAction = (action: FieldLessonLifecycleAction) => {
    setPendingAction(action);
    setNote("");
    setActionError(null);
  };

  const confirmAction = async () => {
    if (!pendingAction || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await onAction(pendingAction, note.trim() || undefined);
      setSubmitting(false);
      setPendingAction(null);
      setNote("");
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : "The lesson status could not be updated.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
        backgroundColor: "rgba(3, 12, 24, 0.68)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-learning-detail-title"
        data-testid="invoice-learning-detail"
        data-status={lesson.status}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "min(88vh, 900px)",
          overflowY: "auto",
          border: "1px solid var(--admin-border-strong)",
          borderRadius: 12,
          backgroundColor: "var(--admin-surface)",
          boxShadow: "0 22px 60px rgba(0, 0, 0, 0.34)",
          color: TEXT,
          fontFamily: FONT,
        }}
      >
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            padding: "18px 20px",
            borderBottom: "1px solid var(--admin-border)",
            backgroundColor: "var(--admin-surface)",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 4px",
                color: MUTED,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Invoice lesson detail
            </p>
            <h3
              id="invoice-learning-detail-title"
              style={{
                margin: 0,
                color: TEXT,
                fontSize: 19,
                lineHeight: 1.25,
              }}
            >
              {FIELD_LABELS[lesson.field]}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invoice lesson detail"
            style={{
              border: "1px solid var(--admin-border-strong)",
              borderRadius: 7,
              padding: "7px 11px",
              backgroundColor: "var(--admin-surface-2)",
              color: TEXT,
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </header>

        <div style={{ padding: 20 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <StatusBadge lesson={lesson} />
            {isVerificationFixture(lesson) && (
              <span
                style={{
                  padding: "4px 9px",
                  borderRadius: 999,
                  border: "1px solid var(--admin-info-border)",
                  backgroundColor: "var(--admin-info-bg)",
                  color: "var(--admin-info-text)",
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                Verification / test
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: "16px 20px",
              padding: 16,
              borderRadius: 9,
              border: "1px solid var(--admin-border)",
              backgroundColor: "var(--admin-surface-2)",
            }}
          >
            <LessonDatum
              label="Target field"
              value={FIELD_LABELS[lesson.field]}
              secondary={lesson.field}
            />
            <LessonDatum
              label="Vendor / scope"
              value={lesson.vendorKey}
              secondary={
                lesson.senderDomain
                  ? `${lesson.senderDomain} · ${lesson.scopeKey}`
                  : lesson.scopeKey
              }
            />
            <LessonDatum
              label="Parser format"
              value={lesson.parserFormatId}
            />
            <LessonDatum
              label="Canonical anchor"
              value={literalAnchor(lesson)}
              secondary={lesson.extractionPattern.canonicalAnchorKeys.join(" · ")}
            />
            <LessonDatum
              label="Capture relationship"
              value={CAPTURE_LABELS[captureShape]}
              secondary={captureShape}
            />
            <LessonDatum
              label="Supporting documents"
              value={`${lesson.distinctDocumentCount} distinct`}
            />
            <LessonDatum
              label="Evaluator version"
              value={lesson.evidenceSnapshot.evaluatorVersion}
            />
            <LessonDatum
              label="Proposed"
              value={formatDate(lesson.proposedAt)}
            />
            <LessonDatum
              label="Evaluated"
              value={formatDate(lesson.evidenceSnapshot.evaluatedAt)}
            />
            {lesson.status === "suspended" && (
              <LessonDatum
                label="Suspension reason"
                value={friendlySuspensionReason(lesson.disabledReason)}
                secondary={
                  lesson.disabledReason === "manual_suspend"
                    ? `Manager · ${lesson.suspendedBy || "actor unavailable"} · ${formatDate(
                        lesson.suspendedAt,
                      )}`
                    : `System · ${formatDate(lesson.suspendedAt)}`
                }
              />
            )}
            {lesson.status === "active" && (
              <>
                <LessonDatum
                  label="Activated"
                  value={formatDate(lesson.activatedAt)}
                  secondary={`Manager · ${lesson.activatedBy || "actor unavailable"}`}
                />
                {lesson.reactivatedAt && (
                  <LessonDatum
                    label="Last reactivated"
                    value={formatDate(lesson.reactivatedAt)}
                    secondary={`Manager · ${lesson.reactivatedBy || "actor unavailable"}`}
                  />
                )}
              </>
            )}
            {lesson.status === "rejected" && (
              <>
                <LessonDatum
                  label="Rejected"
                  value={formatDate(lesson.rejectedAt)}
                  secondary={`Manager · ${lesson.rejectedBy || "actor unavailable"}`}
                />
                <LessonDatum
                  label="Rejection reason"
                  value={lesson.rejectionNote || "Reason not provided"}
                />
              </>
            )}
            {lesson.lastRevalidation && (
              <LessonDatum
                label="Last evidence revalidation"
                value={formatDate(lesson.lastRevalidation.at)}
                secondary={`${lesson.lastRevalidation.confirmedDistinctDocumentCount} documents confirmed · ${lesson.lastRevalidation.droppedVoteCount} dropped`}
              />
            )}
          </div>

          <div style={{ marginTop: 18 }}>
            <p style={detailLabelStyle}>Pattern fingerprint</p>
            <p
              style={{
                margin: 0,
                padding: "9px 11px",
                border: "1px solid var(--admin-border)",
                borderRadius: 7,
                backgroundColor: "var(--admin-surface-2)",
                color: SECONDARY,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {lesson.patternFingerprint}
            </p>
          </div>

          <section data-testid="invoice-learning-evidence" style={{ marginTop: 22 }}>
            <h4
              style={{
                margin: "0 0 5px",
                color: TEXT,
                fontSize: 15,
              }}
            >
              Supporting evidence
            </h4>
            <p
              style={{
                margin: "0 0 12px",
                color: MUTED,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              Sanitized verified values only. Raw invoice text is not displayed.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {lesson.evidenceSnapshot.votes.map((vote, index) => (
                <article
                  key={`${vote.exampleId}-${index}`}
                  style={{
                    padding: 13,
                    border: "1px solid var(--admin-border)",
                    borderRadius: 8,
                    backgroundColor: "var(--admin-surface-2)",
                  }}
                >
                  <div
                    style={{
                      marginBottom: 10,
                      color: "var(--admin-accent-soft)",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    Document {index + 1}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(155px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <LessonDatum
                      label="Corrected value"
                      value={vote.correctedValue}
                    />
                    <LessonDatum
                      label="Matched label"
                      value={vote.matchedLiteral}
                    />
                    <LessonDatum
                      label="Relationship"
                      value={CAPTURE_LABELS[vote.captureShapeId]}
                      secondary={vote.captureShapeId}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section
            data-testid="invoice-learning-lifecycle"
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: "1px solid var(--admin-border)",
            }}
          >
            <h4
              style={{
                margin: "0 0 5px",
                color: TEXT,
                fontSize: 15,
              }}
            >
              Manager decision
            </h4>
            <p
              style={{
                margin: "0 0 13px",
                color: SECONDARY,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Actions are available here only after the supporting evidence has
              been reviewed.
            </p>

            {hasContradiction && (
              <div
                role="alert"
                data-testid="invoice-learning-conflict"
                style={{
                  marginBottom: 13,
                  padding: "11px 12px",
                  border: "1px solid var(--admin-danger-border)",
                  borderRadius: 8,
                  backgroundColor: "var(--admin-danger-bg)",
                  color: "var(--admin-danger-text)",
                  fontSize: 12,
                  fontWeight: 800,
                  lineHeight: 1.45,
                }}
              >
                Conflicting evidence detected. Activation is unavailable while
                the contradiction remains.
              </div>
            )}

            {!pendingAction && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                {lesson.status === "proposed" && !hasContradiction && (
                  <button
                    type="button"
                    onClick={() => beginAction("activate")}
                    style={primaryButtonStyle}
                  >
                    Activate
                  </button>
                )}
                {lesson.status === "proposed" && (
                  <button
                    type="button"
                    onClick={() => beginAction("reject")}
                    style={secondaryButtonStyle}
                  >
                    Reject
                  </button>
                )}
                {lesson.status === "active" && (
                  <button
                    type="button"
                    onClick={() => beginAction("suspend")}
                    style={secondaryButtonStyle}
                  >
                    Suspend
                  </button>
                )}
                {lesson.status === "suspended" && (
                  <button
                    type="button"
                    onClick={() => beginAction("reactivate")}
                    style={primaryButtonStyle}
                  >
                    Reactivate
                  </button>
                )}
                {lesson.status === "rejected" && (
                  <p
                    style={{
                      margin: 0,
                      color: MUTED,
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1.45,
                    }}
                  >
                    Rejected lessons are retained for audit and cannot be
                    activated.
                  </p>
                )}
              </div>
            )}

            {pendingAction && (
              <div
                data-testid="invoice-learning-action-confirm"
                style={{
                  padding: 14,
                  border: "1px solid var(--admin-border-strong)",
                  borderRadius: 9,
                  backgroundColor: "var(--admin-surface-2)",
                }}
              >
                <h5
                  style={{
                    margin: "0 0 5px",
                    color: TEXT,
                    fontSize: 14,
                  }}
                >
                  Confirm {ACTION_LABELS[pendingAction]}
                </h5>
                <p
                  style={{
                    margin: "0 0 12px",
                    color: SECONDARY,
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {ACTION_EXPLANATIONS[pendingAction]}
                </p>

                {(pendingAction === "reject" ||
                  pendingAction === "suspend") && (
                  <label
                    style={{
                      display: "grid",
                      gap: 6,
                      marginBottom: 12,
                      color: TEXT,
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    Reason (recommended)
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder={
                        pendingAction === "reject"
                          ? "Why should this proposed pattern be rejected?"
                          : "Why is this active pattern being suspended?"
                      }
                      style={{
                        boxSizing: "border-box",
                        width: "100%",
                        resize: "vertical",
                        border: "1px solid var(--admin-border-strong)",
                        borderRadius: 7,
                        padding: "9px 10px",
                        backgroundColor: "var(--admin-surface)",
                        color: TEXT,
                        fontFamily: FONT,
                        fontSize: 13,
                        lineHeight: 1.45,
                      }}
                    />
                  </label>
                )}

                {actionError && (
                  <p
                    role="alert"
                    style={{
                      margin: "0 0 10px",
                      color: "var(--admin-danger-text)",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {actionError}
                  </p>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void confirmAction()}
                    style={{
                      ...primaryButtonStyle,
                      cursor: submitting ? "wait" : "pointer",
                      opacity: submitting ? 0.68 : 1,
                    }}
                  >
                    {submitting
                      ? "Saving…"
                      : `Confirm ${ACTION_LABELS[pendingAction]}`}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setPendingAction(null);
                      setNote("");
                      setActionError(null);
                    }}
                    style={{
                      ...secondaryButtonStyle,
                      cursor: submitting ? "not-allowed" : "pointer",
                      opacity: submitting ? 0.68 : 1,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export function InvoiceFieldLessonsSettingsPanel({
  canView,
}: {
  canView: boolean;
}) {
  const [lessons, setLessons] = useState<VendorInvoiceFieldLessonListItem[]>([]);
  const [loading, setLoading] = useState(canView);
  const [error, setError] = useState<string | null>(null);
  const [selectedLesson, setSelectedLesson] =
    useState<VendorInvoiceFieldLessonListItem | null>(null);

  useEffect(() => {
    if (!canView) return;

    let cancelled = false;
    const loadLessons = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const nextLessons = await listVendorInvoiceFieldLessons();
        if (!cancelled) setLessons(nextLessons);
      } catch (err: unknown) {
        if (cancelled) return;
        setLessons([]);
        setError(
          err instanceof Error
            ? err.message
            : "Invoice lessons could not be loaded.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadLessons();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  const orderedLessons = useMemo(
    () =>
      [...lessons].sort((left, right) => {
        if (left.status !== right.status) {
          const statusOrder = {
            proposed: 0,
            active: 1,
            suspended: 2,
            rejected: 3,
          };
          return statusOrder[left.status] - statusOrder[right.status];
        }
        return Date.parse(right.proposedAt) - Date.parse(left.proposedAt);
      }),
    [lessons],
  );
  const proposedCount = lessons.filter(
    (lesson) => lesson.status === "proposed",
  ).length;
  const suspendedCount = lessons.filter(
    (lesson) => lesson.status === "suspended",
  ).length;
  const activeCount = lessons.filter(
    (lesson) => lesson.status === "active",
  ).length;
  const rejectedCount = lessons.filter(
    (lesson) => lesson.status === "rejected",
  ).length;

  const handleLessonAction = async (
    action: FieldLessonLifecycleAction,
    note?: string,
  ) => {
    if (!selectedLesson) return;
    const lessonAtMutation = selectedLesson;
    const result = await setVendorInvoiceFieldLessonStatus({
      lessonId: lessonAtMutation.id,
      action,
      expectedVersion: lessonAtMutation.version,
      idempotencyKey: `${lessonAtMutation.id}:${action}:${lessonAtMutation.version}`,
      ...(note ? { note } : {}),
    });

    let nextLessons = lessons.map((lesson) =>
      lesson.id === result.lessonId
        ? { ...lesson, status: result.status, version: result.version }
        : lesson,
    );
    try {
      nextLessons = await listVendorInvoiceFieldLessons();
    } catch {
      // Mutation result remains authoritative if the follow-up list refresh is unavailable.
    }
    setLessons(nextLessons);
    setSelectedLesson(
      nextLessons.find((lesson) => lesson.id === result.lessonId) ?? null,
    );
  };

  return (
    <div
      data-testid="invoice-learning-panel"
      style={{
        padding: 20,
        color: TEXT,
        fontFamily: FONT,
      }}
    >
      <p
        style={{
          margin: "0 0 18px",
          maxWidth: 800,
          color: SECONDARY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.55,
        }}
      >
        These are deterministic extraction patterns StageVerify has learned from
        verified invoice evidence. Parser application is not live yet.
      </p>

      {!canView ? (
        <div
          style={{
            padding: "13px 14px",
            border: "1px solid var(--admin-warning-border)",
            borderRadius: 8,
            backgroundColor: "var(--admin-warning-bg)",
            color: "var(--admin-warning-text)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Manager access required to view invoice learning evidence.
        </div>
      ) : (
        <>
          <div
            data-testid="invoice-learning-summary"
            aria-label={`Proposed ${proposedCount}, Active ${activeCount}, Suspended ${suspendedCount}, Rejected ${rejectedCount}`}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 10,
              marginBottom: 18,
            }}
          >
            <CountCard
              label="Proposed"
              count={proposedCount}
              testId="invoice-learning-proposed-count"
              accent="var(--admin-warning-text)"
            />
            <CountCard
              label="Active"
              count={activeCount}
              testId="invoice-learning-active-count"
              accent="var(--admin-success-text)"
            />
            <CountCard
              label="Suspended"
              count={suspendedCount}
              testId="invoice-learning-suspended-count"
              accent="var(--admin-danger-text)"
            />
            <CountCard
              label="Rejected"
              count={rejectedCount}
              testId="invoice-learning-rejected-count"
              accent={NAVY}
            />
          </div>

          {loading && (
            <p
              role="status"
              style={{ margin: 0, color: MUTED, fontSize: 13, fontWeight: 600 }}
            >
              Loading invoice lessons…
            </p>
          )}

          {!loading && error && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "12px 14px",
                border: "1px solid var(--admin-danger-border)",
                borderRadius: 8,
                backgroundColor: "var(--admin-danger-bg)",
                color: "var(--admin-danger-text)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </p>
          )}

          {!loading && !error && orderedLessons.length === 0 && (
            <div
              data-testid="invoice-learning-empty"
              style={{
                padding: "22px 18px",
                border: "1px dashed var(--admin-border-strong)",
                borderRadius: 9,
                backgroundColor: "var(--admin-surface-2)",
              }}
            >
              <p
                style={{
                  margin: "0 0 7px",
                  color: TEXT,
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                No proposed invoice lessons yet.
              </p>
              <p
                style={{
                  margin: 0,
                  color: SECONDARY,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                C3-D.1 requires at least three distinct qualifying documents with
                the same approved extraction pattern.
              </p>
            </div>
          )}

          {!loading && !error && orderedLessons.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {orderedLessons.map((lesson) => {
                const captureShape = lesson.extractionPattern.captureShapeId;
                const fixture = isVerificationFixture(lesson);
                return (
                  <article
                    key={lesson.id}
                    tabIndex={0}
                    aria-label={`View ${FIELD_LABELS[lesson.field]} invoice lesson`}
                    data-testid={`invoice-learning-lesson-${lesson.id}`}
                    data-status={lesson.status}
                    onClick={() => setSelectedLesson(lesson)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedLesson(lesson);
                      }
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: 15,
                      border: "1px solid var(--admin-border)",
                      borderLeft: `4px solid ${statusAccent(lesson)}`,
                      borderRadius: 9,
                      backgroundColor: "var(--admin-surface-2)",
                      color: TEXT,
                      fontFamily: FONT,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap",
                        marginBottom: 14,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            color: TEXT,
                            fontSize: 15,
                            fontWeight: 800,
                            lineHeight: 1.3,
                          }}
                        >
                          {FIELD_LABELS[lesson.field]}
                        </div>
                        <div
                          style={{
                            marginTop: 3,
                            color: MUTED,
                            fontSize: 11,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {lesson.field}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        }}
                      >
                        {fixture && (
                          <span
                            style={{
                              padding: "4px 9px",
                              border: "1px solid var(--admin-info-border)",
                              borderRadius: 999,
                              backgroundColor: "var(--admin-info-bg)",
                              color: "var(--admin-info-text)",
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            Verification / test
                          </span>
                        )}
                        <StatusBadge lesson={lesson} />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(165px, 1fr))",
                        gap: "13px 18px",
                      }}
                    >
                      <LessonDatum
                        label="Vendor / scope"
                        value={lesson.vendorKey}
                        secondary={lesson.senderDomain || lesson.scopeKey}
                      />
                      <LessonDatum
                        label="Parser format"
                        value={lesson.parserFormatId}
                      />
                      <LessonDatum
                        label="Approved literal anchor"
                        value={literalAnchor(lesson)}
                      />
                      <LessonDatum
                        label="Capture shape"
                        value={CAPTURE_LABELS[captureShape]}
                        secondary={captureShape}
                      />
                      <LessonDatum
                        label="Supporting documents"
                        value={`${lesson.distinctDocumentCount} distinct`}
                        secondary={
                          lesson.status === "suspended"
                            ? friendlySuspensionReason(lesson.disabledReason)
                            : "Evidence threshold met"
                        }
                      />
                      <LessonDatum
                        label="Proposed / evaluated"
                        value={formatDate(lesson.proposedAt)}
                        secondary={`Evaluated ${formatDate(
                          lesson.evidenceSnapshot.evaluatedAt,
                        )}`}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {canView && selectedLesson && (
        <LessonDetail
          lesson={selectedLesson}
          onClose={() => setSelectedLesson(null)}
          onAction={handleLessonAction}
        />
      )}
    </div>
  );
}
