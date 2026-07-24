import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { OfficeReceiver } from "./dispatcher/models";
import {
  createOfficeReceiver,
  listOfficeReceivers,
  updateOfficeReceiver,
} from "./dispatcher/firestoreService";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "#333";
const MUTED = "#6b7280";

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccd0d7",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "#fff",
  fontFamily: FONT,
};

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes("@") && trimmed.length <= 254;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits.length ? `(${digits}` : "";
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidPhone(value: string): boolean {
  return value.replace(/\D/g, "").length === 10;
}

export function OfficeReceiversSettingsPanel() {
  const [receivers, setReceivers] = useState<OfficeReceiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [receiverName, setReceiverName] = useState("");
  const [receiverEmail, setReceiverEmail] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [phoneSavingId, setPhoneSavingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const handleAddReceiver = async () => {
    const name = receiverName.trim();
    const email = receiverEmail.trim();
    const phoneRaw = receiverPhone.trim();
    if (!name || !isValidEmail(email)) {
      setError("Name and a valid email are required.");
      return;
    }
    if (phoneRaw && !isValidPhone(phoneRaw)) {
      setError("Phone must be a 10-digit US number when provided.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = `office-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      await createOfficeReceiver({
        id,
        name,
        email: email.toLowerCase(),
        ...(phoneRaw ? { phone: formatPhone(phoneRaw) } : {}),
        active: true,
        catchAllCheckInEnabled: true,
        notifyEmail: true,
        notifySms: false,
        createdAt: now,
        updatedAt: now,
      });
      setReceiverName("");
      setReceiverEmail("");
      setReceiverPhone("");
      await reload();
    } catch {
      setError("Could not save office receiver.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (receiver: OfficeReceiver) => {
    await updateOfficeReceiver({
      ...receiver,
      active: receiver.active === false,
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

  const saveReceiverPhone = async (receiver: OfficeReceiver) => {
    const draft = (phoneDrafts[receiver.id] ?? "").trim();
    if (!isValidPhone(draft)) {
      setError("Phone must be a 10-digit US number.");
      return;
    }
    setPhoneSavingId(receiver.id);
    setError(null);
    try {
      await updateOfficeReceiver({
        ...receiver,
        phone: formatPhone(draft),
        updatedAt: new Date().toISOString(),
      });
      setPhoneDrafts((prev) => {
        const next = { ...prev };
        delete next[receiver.id];
        return next;
      });
      await reload();
    } catch {
      setError("Could not save phone number.");
    } finally {
      setPhoneSavingId(null);
    }
  };

  const clearReceiverPhone = async (receiver: OfficeReceiver) => {
    setPhoneSavingId(receiver.id);
    setError(null);
    try {
      await updateOfficeReceiver({
        ...receiver,
        phone: "",
        updatedAt: new Date().toISOString(),
      });
      await reload();
    } catch {
      setError("Could not remove phone number.");
    } finally {
      setPhoneSavingId(null);
    }
  };

  return (
    <div
      data-testid="office-receivers-settings-panel"
      style={{
        border: "1.5px solid #ccd0d7",
        borderRadius: 8,
        backgroundColor: "#fff",
        marginBottom: 24,
        color: TEXT,
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
          fontWeight: 700,
          fontSize: 16,
          color: NAVY,
          fontFamily: FONT,
        }}
      >
        Office receivers
      </div>
      <div style={{ padding: 20, fontFamily: FONT }}>
        {loading ? (
          <p style={{ fontSize: 14, color: MUTED }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
              Staff who receive catch-all delivery alert emails. Check-in still
              uses the shared management PIN at any location QR — these contacts
              are notify targets only.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
              {receivers.map((receiver) => (
                <li
                  key={receiver.id}
                  data-testid={`office-receiver-row-${receiver.id}`}
                  style={{
                    padding: "12px 0",
                    borderBottom: "1px solid #f3f4f6",
                    fontSize: 14,
                    color: TEXT,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <strong>{receiver.name}</strong>
                      {receiver.active === false ? " (inactive)" : ""}
                      {receiver.email ? ` · ${receiver.email}` : ""}
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleActive(receiver)}
                      style={{
                        fontSize: 12,
                        color: NAVY,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {receiver.active === false ? "Activate" : "Deactivate"}
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 12,
                      marginTop: 8,
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
                        data-testid={`office-receiver-catchall-${receiver.id}`}
                        checked={receiver.catchAllCheckInEnabled !== false}
                        disabled={receiver.active === false}
                        onChange={() => void toggleCatchAllEnabled(receiver)}
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
                        data-testid={`office-receiver-email-${receiver.id}`}
                        checked={receiver.notifyEmail !== false}
                        disabled={receiver.active === false || !receiver.email}
                        onChange={() => void toggleNotifyEmail(receiver)}
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
                        data-testid={`office-receiver-sms-${receiver.id}`}
                        checked={false}
                        disabled
                      />
                      SMS (coming soon)
                    </label>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 10,
                      alignItems: "center",
                    }}
                  >
                    {receiver.phone?.trim() ? (
                      <span
                        data-testid={`office-receiver-phone-chip-${receiver.id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          borderRadius: 999,
                          backgroundColor: "#e5e7eb",
                          color: TEXT,
                          fontSize: 13,
                          fontFamily: FONT,
                        }}
                      >
                        {receiver.phone}
                        <button
                          type="button"
                          aria-label="Remove phone"
                          disabled={
                            receiver.active === false || phoneSavingId === receiver.id
                          }
                          data-testid={`office-receiver-phone-remove-${receiver.id}`}
                          onClick={() => void clearReceiverPhone(receiver)}
                          style={{
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: MUTED,
                            fontSize: 16,
                            lineHeight: 1,
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      <>
                        <input
                          type="tel"
                          placeholder="Mobile phone"
                          value={phoneDrafts[receiver.id] ?? ""}
                          disabled={receiver.active === false}
                          onChange={(e) =>
                            setPhoneDrafts((prev) => ({
                              ...prev,
                              [receiver.id]: formatPhone(e.target.value),
                            }))
                          }
                          data-testid={`office-receiver-phone-input-${receiver.id}`}
                          style={{ ...inputStyle, minWidth: 160 }}
                        />
                        <button
                          type="button"
                          disabled={
                            receiver.active === false ||
                            phoneSavingId === receiver.id ||
                            !isValidPhone(phoneDrafts[receiver.id] ?? "")
                          }
                          data-testid={`office-receiver-phone-save-${receiver.id}`}
                          onClick={() => void saveReceiverPhone(receiver)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 6,
                            border: `1px solid ${NAVY}`,
                            backgroundColor: "#fff",
                            color: NAVY,
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          Save phone
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {receivers.length === 0 && (
                <li style={{ fontSize: 14, color: MUTED }}>
                  No office receivers yet.
                </li>
              )}
            </ul>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <input
                type="text"
                placeholder="Name"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                data-testid="office-receiver-name-input"
                style={inputStyle}
              />
              <input
                type="email"
                placeholder="Email"
                value={receiverEmail}
                onChange={(e) => setReceiverEmail(e.target.value)}
                data-testid="office-receiver-email-input"
                style={{ ...inputStyle, minWidth: 220 }}
              />
              <input
                type="tel"
                placeholder="Mobile phone (optional)"
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(formatPhone(e.target.value))}
                data-testid="office-receiver-add-phone-input"
                style={{ ...inputStyle, minWidth: 160 }}
              />
              <button
                type="button"
                disabled={saving}
                data-testid="office-receiver-add-btn"
                onClick={() => void handleAddReceiver()}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: NAVY,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add office receiver
              </button>
            </div>
            {error ? (
              <p style={{ color: "#bf0a30", fontSize: 13 }}>{error}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
