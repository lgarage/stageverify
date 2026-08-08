import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { OfficeReceiver } from "./dispatcher/models";
import {
  createOfficeReceiver,
  listOfficeReceivers,
  updateOfficeReceiver,
} from "./dispatcher/firestoreService";
import { isVerifySeedOfficeReceiver } from "./lib/isVerifySeedOfficeReceiver";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "var(--admin-text)";
const MUTED = "var(--admin-text-muted)";
const ACTIVE_GREEN = "var(--admin-success-text)";
const ACTIVATE_YELLOW = "#ffc107";
const RECEIVER_FORM_TITLE = "Catch-All Receiver";

const activateButtonStyle: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #e6a800",
  backgroundColor: ACTIVATE_YELLOW,
  color: TEXT,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: FONT,
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--admin-border)",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "var(--admin-surface)",
  fontFamily: FONT,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: MUTED,
  marginBottom: 4,
  fontFamily: FONT,
};

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes("@") && trimmed.length <= 254;
}

type ReceiverDraft = {
  localId: string;
  name: string;
  email: string;
  catchAllCheckInEnabled: boolean;
  notifyEmail: boolean;
};

function newDraft(): ReceiverDraft {
  return {
    localId: crypto.randomUUID(),
    name: "",
    email: "",
    catchAllCheckInEnabled: true,
    notifyEmail: true,
  };
}

function statusNoteFor(receiver: OfficeReceiver): string {
  if (receiver.active === false) return "";
  const parts: string[] = [];
  if (receiver.notifyEmail !== false && receiver.email?.trim()) {
    parts.push("email notifications active");
  }
  if (receiver.notifySms === true && receiver.phone?.trim()) {
    parts.push("SMS notifications active");
  }
  return parts.join(" · ");
}

export function OfficeReceiversSettingsPanel() {
  const [receivers, setReceivers] = useState<OfficeReceiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<ReceiverDraft[]>([]);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listOfficeReceivers();
      setReceivers([...rows].sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const displayReceivers = receivers.filter(
    (r) => !isVerifySeedOfficeReceiver(r),
  );

  useEffect(() => {
    if (loading) return;
    if (displayReceivers.length === 0 && drafts.length === 0) {
      setDrafts([newDraft()]);
    }
  }, [loading, displayReceivers.length, drafts.length]);

  const saveDraft = async (draft: ReceiverDraft) => {
    const name = draft.name.trim();
    const email = draft.email.trim();
    if (!name || !isValidEmail(email)) {
      setError("Name and a valid email are required.");
      return;
    }
    setSavingDraftId(draft.localId);
    setError(null);
    try {
      const id = `office-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      await createOfficeReceiver({
        id,
        name,
        email: email.toLowerCase(),
        active: true,
        catchAllCheckInEnabled: draft.catchAllCheckInEnabled,
        notifyEmail: draft.notifyEmail,
        notifySms: false,
        createdAt: now,
        updatedAt: now,
      });
      setDrafts((prev) => prev.filter((d) => d.localId !== draft.localId));
      await reload();
    } catch {
      setError("Could not save Catch-All receiver.");
    } finally {
      setSavingDraftId(null);
    }
  };

  const toggleActive = async (receiver: OfficeReceiver) => {
    if (receiver.active !== false) return;
    await updateOfficeReceiver({
      ...receiver,
      active: true,
      updatedAt: new Date().toISOString(),
    });
    await reload();
  };

  const deactivateReceiver = async (receiver: OfficeReceiver) => {
    await updateOfficeReceiver({
      ...receiver,
      active: false,
      updatedAt: new Date().toISOString(),
    });
    await reload();
  };

  const toggleCatchAllEnabled = async (receiver: OfficeReceiver) => {
    await updateOfficeReceiver({
      ...receiver,
      catchAllCheckInEnabled: receiver.catchAllCheckInEnabled === false,
      updatedAt: new Date().toISOString(),
    });
    await reload();
  };

  const toggleNotifyEmail = async (receiver: OfficeReceiver) => {
    await updateOfficeReceiver({
      ...receiver,
      notifyEmail: receiver.notifyEmail === false,
      updatedAt: new Date().toISOString(),
    });
    await reload();
  };

  const updateDraftField = (
    localId: string,
    patch: Partial<Omit<ReceiverDraft, "localId">>,
  ) => {
    setDrafts((prev) =>
      prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)),
    );
  };

  const addDraftForm = () => {
    setDrafts((prev) => [...prev, newDraft()]);
  };

  const cancelAllDraftForms = () => {
    setDrafts([]);
    setError(null);
  };

  const showCancelDrafts =
    displayReceivers.length > 0
      ? drafts.length >= 1
      : drafts.length > 1;

  const checkboxRow = (
    idPrefix: string,
    opts: {
      catchAll: boolean;
      email: boolean;
      catchAllDisabled?: boolean;
      emailDisabled?: boolean;
      onCatchAllChange?: () => void;
      onEmailChange?: () => void;
    },
  ) => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
      }}
    >
      <label
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 13,
          color: TEXT,
        }}
      >
        <input
          type="checkbox"
          data-testid={`office-receiver-catchall-${idPrefix}`}
          checked={opts.catchAll}
          disabled={opts.catchAllDisabled}
          onChange={opts.onCatchAllChange}
        />
        Catch-all check-in alerts
      </label>
      <label
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 13,
          color: TEXT,
        }}
      >
        <input
          type="checkbox"
          data-testid={`office-receiver-email-${idPrefix}`}
          checked={opts.email}
          disabled={opts.emailDisabled}
          onChange={opts.onEmailChange}
        />
        Email notify
      </label>
      <label
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          fontSize: 13,
          color: MUTED,
        }}
        title="SMS deferred until Twilio is approved"
      >
        <input
          type="checkbox"
          data-testid={`office-receiver-sms-${idPrefix}`}
          checked={false}
          disabled
        />
        SMS (coming soon)
      </label>
    </div>
  );

  return (
    <div
      data-testid="office-receivers-settings-panel"
      style={{
        border: "1.5px solid var(--admin-border)",
        borderRadius: 8,
        backgroundColor: "var(--admin-surface)",
        marginBottom: 24,
        color: TEXT,
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--admin-border)",
          fontWeight: 700,
          fontSize: 16,
          color: "var(--admin-accent-soft)",
          fontFamily: FONT,
        }}
      >
        Catch-All receivers
      </div>
      <div style={{ padding: 20, fontFamily: FONT }}>
        {loading ? (
          <p style={{ fontSize: 14, color: MUTED }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>
              Notify targets for Catch-All delivery alerts — staff who receive
              email when a catch-all parcel needs check-in. On-site check-in
              still uses a management PIN (in PIN &amp; Access Management); these
              contacts are alert recipients only.
            </p>

            {displayReceivers.length > 0 ? (
              <div style={{ marginBottom: 20 }}>
                {displayReceivers.map((receiver) => {
                  const isActive = receiver.active !== false;
                  const note = statusNoteFor(receiver);
                  return (
                    <div
                      key={receiver.id}
                      data-testid={`office-receiver-row-${receiver.id}`}
                      style={{
                        padding: "16px 0",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--admin-accent-soft)",
                          marginBottom: 10,
                        }}
                        data-testid={`office-receiver-row-title-${receiver.id}`}
                      >
                        {RECEIVER_FORM_TITLE}
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <span style={labelStyle}>Name</span>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: TEXT,
                          }}
                        >
                          {receiver.name}
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <span style={labelStyle}>Email</span>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontSize: 14, color: TEXT }}>
                            {receiver.email ?? "—"}
                          </span>
                          {note ? (
                            <span
                              data-testid={`office-receiver-status-note-${receiver.id}`}
                              style={{
                                fontSize: 13,
                                color: ACTIVE_GREEN,
                                fontWeight: 600,
                              }}
                            >
                              {note}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <span style={labelStyle}>SMS (coming soon)</span>
                        <input
                          type="text"
                          value=""
                          disabled
                          placeholder="Not available yet"
                          data-testid={`office-receiver-sms-coming-soon-${receiver.id}`}
                          style={{
                            ...inputStyle,
                            width: "100%",
                            maxWidth: 280,
                            opacity: 0.75,
                            cursor: "not-allowed",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        {checkboxRow(receiver.id, {
                          catchAll: receiver.catchAllCheckInEnabled !== false,
                          email: receiver.notifyEmail !== false,
                          catchAllDisabled: !isActive,
                          emailDisabled: !isActive || !receiver.email,
                          onCatchAllChange: () =>
                            void toggleCatchAllEnabled(receiver),
                          onEmailChange: () => void toggleNotifyEmail(receiver),
                        })}
                        {isActive ? (
                          <button
                            type="button"
                            disabled
                            data-testid={`office-receiver-active-status-${receiver.id}`}
                            style={{
                              padding: "6px 14px",
                              borderRadius: 6,
                              border: "none",
                              backgroundColor: ACTIVE_GREEN,
                              color: "var(--admin-text)",
                              fontWeight: 700,
                              fontSize: 13,
                              cursor: "default",
                              fontFamily: FONT,
                            }}
                          >
                            Active
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-testid={`office-receiver-activate-${receiver.id}`}
                            onClick={() => void toggleActive(receiver)}
                            style={activateButtonStyle}
                          >
                            Activate
                          </button>
                        )}
                        {isActive ? (
                          <button
                            type="button"
                            onClick={() => void deactivateReceiver(receiver)}
                            style={{
                              fontSize: 12,
                              color: MUTED,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              textDecoration: "underline",
                              marginLeft: "auto",
                            }}
                          >
                            Set inactive
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div data-testid="office-receiver-signup-section">
              {drafts.map((draft, index) => (
                <div
                  key={draft.localId}
                  data-testid={`office-receiver-signup-form-${index}`}
                  style={{
                    padding: "14px 0",
                    borderTop: index > 0 ? "1px solid #f3f4f6" : undefined,
                    marginBottom: 8,
                  }}
                >
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--admin-accent-soft)",
                      marginBottom: 12,
                    }}
                    data-testid={
                      index === 0
                        ? "office-receiver-signup-title"
                        : `office-receiver-signup-title-${index}`
                    }
                  >
                    {RECEIVER_FORM_TITLE}
                  </p>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle} htmlFor={`draft-name-${draft.localId}`}>
                      Name
                    </label>
                    <input
                      id={`draft-name-${draft.localId}`}
                      type="text"
                      placeholder="Full name"
                      value={draft.name}
                      onChange={(e) =>
                        updateDraftField(draft.localId, {
                          name: e.target.value,
                        })
                      }
                      data-testid={
                        index === 0
                          ? "office-receiver-name-input"
                          : `office-receiver-name-input-${index}`
                      }
                      style={{ ...inputStyle, width: "100%", maxWidth: 480 }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle} htmlFor={`draft-email-${draft.localId}`}>
                      Email
                    </label>
                    <input
                      id={`draft-email-${draft.localId}`}
                      type="email"
                      placeholder="name@company.com"
                      value={draft.email}
                      onChange={(e) =>
                        updateDraftField(draft.localId, {
                          email: e.target.value,
                        })
                      }
                      data-testid={
                        index === 0
                          ? "office-receiver-email-input"
                          : `office-receiver-email-input-${index}`
                      }
                      style={{ ...inputStyle, width: "100%", maxWidth: 480 }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <span style={labelStyle}>SMS (coming soon)</span>
                    <input
                      type="text"
                      value=""
                      disabled
                      placeholder="Not available yet"
                      data-testid={
                        index === 0
                          ? "office-receiver-sms-coming-soon-input"
                          : `office-receiver-sms-coming-soon-input-${index}`
                      }
                      style={{
                        ...inputStyle,
                        width: "100%",
                        maxWidth: 280,
                        opacity: 0.75,
                        cursor: "not-allowed",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    {checkboxRow(`draft-${draft.localId}`, {
                      catchAll: draft.catchAllCheckInEnabled,
                      email: draft.notifyEmail,
                      onCatchAllChange: () =>
                        updateDraftField(draft.localId, {
                          catchAllCheckInEnabled: !draft.catchAllCheckInEnabled,
                        }),
                      onEmailChange: () =>
                        updateDraftField(draft.localId, {
                          notifyEmail: !draft.notifyEmail,
                        }),
                    })}
                    <button
                      type="button"
                      disabled={savingDraftId === draft.localId}
                      data-testid={
                        index === 0
                          ? "office-receiver-add-btn"
                          : `office-receiver-save-draft-${index}`
                      }
                      onClick={() => void saveDraft(draft)}
                      style={{
                        ...activateButtonStyle,
                        cursor:
                          savingDraftId === draft.localId
                            ? "wait"
                            : "pointer",
                        opacity: savingDraftId === draft.localId ? 0.7 : 1,
                      }}
                    >
                      Activate
                    </button>
                  </div>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  data-testid="office-receiver-add-additional-btn"
                  onClick={addDraftForm}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: `1px solid ${NAVY}`,
                    backgroundColor: "var(--admin-surface)",
                    color: "var(--admin-accent-soft)",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  Add additional Catch-All receivers
                </button>
                {showCancelDrafts ? (
                  <button
                    type="button"
                    data-testid="office-receiver-cancel-drafts-btn"
                    onClick={cancelAllDraftForms}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 6,
                      border: "1px solid var(--admin-border)",
                      backgroundColor: "var(--admin-surface)",
                      color: MUTED,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>

            {error ? (
              <p style={{ color: "#bf0a30", fontSize: 13, marginTop: 12 }}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
