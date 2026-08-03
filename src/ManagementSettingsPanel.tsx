import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type {
  ManagementPinPermissions,
  ManagementPinPublic,
  StagingLocation,
} from "./dispatcher/models";
import {
  getAppSettings,
  listAllZones,
  updateAppSettings,
} from "./dispatcher/firestoreService";
import {
  deactivateManagementPinClient,
  listManagementPinsClient,
  upsertManagementPinClient,
} from "./phase2CallableClients";
import { sortStagingLocationsForList } from "./dispatcher/stagingMapSync";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "#333";
const MUTED = "#6b7280";
const NAVY = "#0a3161";

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccd0d7",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "#fff",
  fontFamily: FONT,
};

const CAP_LABELS: Array<{
  key: keyof Required<ManagementPinPermissions>;
  label: string;
}> = [
  { key: "enterPortalAnyQr", label: "Enter portal from any location QR" },
  { key: "catchAllCheckIn", label: "Catch-all / CA check-in" },
  { key: "viewWaitingParts", label: "View jobs awaiting parts" },
  { key: "markOrFlagParcel", label: "Mark received / flag unidentifiable" },
];

const defaultPermissions = (): Required<ManagementPinPermissions> => ({
  enterPortalAnyQr: true,
  catchAllCheckIn: true,
  viewWaitingParts: true,
  markOrFlagParcel: true,
});

function normalizePermissions(
  permissions?: ManagementPinPermissions,
): Required<ManagementPinPermissions> {
  return {
    enterPortalAnyQr: permissions?.enterPortalAnyQr !== false,
    catchAllCheckIn: permissions?.catchAllCheckIn !== false,
    viewWaitingParts: permissions?.viewWaitingParts !== false,
    markOrFlagParcel: permissions?.markOrFlagParcel !== false,
  };
}

export function ManagementSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [spots, setSpots] = useState<StagingLocation[]>([]);
  const [catchAllStagingLocationId, setCatchAllStagingLocationId] = useState("");
  const [parcelIntakeEnabled, setParcelIntakeEnabled] = useState(false);
  const [managementSessionMinutes, setManagementSessionMinutes] = useState(30);
  const [pins, setPins] = useState<ManagementPinPublic[]>([]);
  const [saving, setSaving] = useState(false);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPermissions, setNewPermissions] = useState(defaultPermissions);
  const [pinEdits, setPinEdits] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, locations, pinResult] = await Promise.all([
        getAppSettings(),
        listAllZones(),
        listManagementPinsClient().catch(() => ({ pins: [] as ManagementPinPublic[] })),
      ]);
      setCatchAllStagingLocationId(settings.catchAllStagingLocationId ?? "");
      setParcelIntakeEnabled(settings.parcelIntakeEnabled === true);
      setManagementSessionMinutes(settings.managementSessionMinutes ?? 30);
      setPins(pinResult.pins);
      setSpots(sortStagingLocationsForList(locations));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveCatchAllConfig = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateAppSettings({
        catchAllStagingLocationId: catchAllStagingLocationId || undefined,
        parcelIntakeEnabled:
          parcelIntakeEnabled && Boolean(catchAllStagingLocationId),
        managementSessionMinutes,
      });
      setMessage("Catch-all parcel intake settings saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createPin = async () => {
    const pin = newPin.trim();
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit PIN for the new entry.");
      return;
    }
    setPinBusyId("__new__");
    setError(null);
    setMessage(null);
    try {
      await upsertManagementPinClient({
        label: newLabel.trim() || "Office PIN",
        pin,
        active: true,
        permissions: newPermissions,
      });
      setNewLabel("");
      setNewPin("");
      setNewPermissions(defaultPermissions());
      setMessage("Management PIN created.");
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create management PIN.",
      );
    } finally {
      setPinBusyId(null);
    }
  };

  const savePinCode = async (row: ManagementPinPublic) => {
    const pin = (pinEdits[row.id] ?? "").trim();
    if (!/^\d{4}$/.test(pin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    setPinBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      await upsertManagementPinClient({
        id: row.id,
        pin,
        label: row.label,
        active: row.active,
        permissions: normalizePermissions(row.permissions),
      });
      setPinEdits((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setMessage(`PIN updated for ${row.label}.`);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update PIN.",
      );
    } finally {
      setPinBusyId(null);
    }
  };

  const updatePinPermissions = async (
    row: ManagementPinPublic,
    patch: Partial<ManagementPinPermissions>,
  ) => {
    setPinBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      await upsertManagementPinClient({
        id: row.id,
        label: row.label,
        active: row.active,
        permissions: { ...normalizePermissions(row.permissions), ...patch },
      });
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update capabilities.",
      );
    } finally {
      setPinBusyId(null);
    }
  };

  const updatePinLabel = async (row: ManagementPinPublic, label: string) => {
    const trimmed = label.trim();
    if (!trimmed || trimmed === row.label) return;
    setPinBusyId(row.id);
    setError(null);
    try {
      await upsertManagementPinClient({
        id: row.id,
        label: trimmed,
        active: row.active,
        permissions: normalizePermissions(row.permissions),
      });
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename PIN.",
      );
    } finally {
      setPinBusyId(null);
    }
  };

  const deactivatePin = async (row: ManagementPinPublic) => {
    setPinBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      await deactivateManagementPinClient({ id: row.id });
      setMessage(`${row.label} deactivated.`);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to deactivate PIN.",
      );
    } finally {
      setPinBusyId(null);
    }
  };

  if (loading) {
    return (
      <p style={{ fontSize: 14, color: MUTED, padding: 16 }}>
        Loading management settings…
      </p>
    );
  }

  return (
    <div style={{ padding: 20 }} data-testid="management-settings-panel">
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: "0 0 8px" }}>
        Catch-all parcel intake (Phase 6)
      </h2>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px", maxWidth: 640 }}>
        Assign a dedicated staging spot for office parcel drops. Office staff scan
        any location QR and enter a management PIN. Capabilities are per PIN —
        unrelated to Office receivers notify contacts below.
      </p>

      {error && (
        <p style={{ fontSize: 13, color: "#bf0a30", marginBottom: 12 }} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p style={{ fontSize: 13, color: "#166534", marginBottom: 12 }} role="status">
          {message}
        </p>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <label style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>
          Catch-all spot
        </label>
        <select
          value={catchAllStagingLocationId}
          onChange={(e) => setCatchAllStagingLocationId(e.target.value)}
          style={{ ...inputStyle, minWidth: 160 }}
          data-testid="mgmt-catch-all-spot-select"
        >
          <option value="">— Select spot —</option>
          {spots.map((spot) => (
            <option key={spot.id} value={spot.id}>
              {spot.code} — {spot.label}
            </option>
          ))}
        </select>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: TEXT,
          }}
        >
          <input
            type="checkbox"
            checked={parcelIntakeEnabled}
            onChange={(e) => setParcelIntakeEnabled(e.target.checked)}
            data-testid="mgmt-parcel-intake-enabled"
          />
          Enable parcel intake
        </label>
        <label style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>
          Session TTL (min)
        </label>
        <input
          type="number"
          min={5}
          max={480}
          value={managementSessionMinutes}
          onChange={(e) =>
            setManagementSessionMinutes(Number(e.target.value) || 30)
          }
          style={{ ...inputStyle, width: 72 }}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveCatchAllConfig()}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "none",
            backgroundColor: NAVY,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? "wait" : "pointer",
          }}
          data-testid="mgmt-catch-all-save"
        >
          {saving ? "Saving…" : "Save intake config"}
        </button>
      </div>

      <div
        style={{
          borderTop: "1px solid #e5e7eb",
          paddingTop: 16,
        }}
        data-testid="mgmt-pins-section"
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: NAVY,
            margin: "0 0 8px",
            fontFamily: FONT,
          }}
        >
          Management PINs & capabilities
        </h3>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", maxWidth: 640 }}>
          Each PIN can be granted different office actions. Active PIN codes must be
          unique. Deactivating a PIN ends its elevated actions on the next CF call.
        </p>

        {pins.length === 0 ? (
          <p style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
            No management PINs yet — create one below (e.g. 1234 for full office access).
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pins.map((row) => {
              const caps = normalizePermissions(row.permissions);
              const busy = pinBusyId === row.id;
              return (
                <div
                  key={row.id}
                  data-testid={`mgmt-pin-row-${row.id}`}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 14,
                    backgroundColor: row.active ? "#fff" : "#f9fafb",
                    opacity: row.active ? 1 : 0.75,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <input
                      type="text"
                      defaultValue={row.label}
                      onBlur={(e) => void updatePinLabel(row, e.target.value)}
                      style={{ ...inputStyle, minWidth: 160, fontWeight: 600 }}
                      data-testid={`mgmt-pin-label-${row.id}`}
                      aria-label="PIN label"
                    />
                    <span style={{ fontSize: 12, color: MUTED }}>
                      {row.active ? (row.hasPin ? "Active" : "Active · no PIN set") : "Inactive"}
                    </span>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="Rotate PIN"
                      value={pinEdits[row.id] ?? ""}
                      onChange={(e) =>
                        setPinEdits((prev) => ({
                          ...prev,
                          [row.id]: e.target.value.replace(/\D/g, "").slice(0, 4),
                        }))
                      }
                      style={{ ...inputStyle, width: 110 }}
                      data-testid={`mgmt-pin-input-${row.id}`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void savePinCode(row)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "none",
                        backgroundColor: NAVY,
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: busy ? "wait" : "pointer",
                      }}
                      data-testid={`mgmt-pin-save-${row.id}`}
                    >
                      {busy ? "…" : "Set PIN"}
                    </button>
                    {row.active && !row.virtual && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deactivatePin(row)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 6,
                          border: "1px solid #ccd0d7",
                          backgroundColor: "#fff",
                          color: TEXT,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: busy ? "wait" : "pointer",
                        }}
                        data-testid={`mgmt-pin-deactivate-${row.id}`}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {CAP_LABELS.map(({ key, label }) => (
                      <label
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          color: TEXT,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={caps[key]}
                          disabled={busy || !row.active}
                          onChange={(e) =>
                            void updatePinPermissions(row, {
                              [key]: e.target.checked,
                            })
                          }
                          data-testid={`mgmt-pin-cap-${row.id}-${key}`}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            border: "1px dashed #ccd0d7",
            borderRadius: 8,
            padding: 14,
            backgroundColor: "#fafbfc",
          }}
          data-testid="mgmt-pin-create"
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: TEXT, margin: "0 0 10px" }}>
            Add management PIN
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <input
              type="text"
              placeholder="Label (e.g. Front office)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ ...inputStyle, minWidth: 180 }}
              data-testid="mgmt-pin-new-label"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="4-digit PIN"
              value={newPin}
              onChange={(e) =>
                setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              style={{ ...inputStyle, width: 120 }}
              data-testid="mgmt-pin-new-code"
            />
            <button
              type="button"
              disabled={pinBusyId === "__new__"}
              onClick={() => void createPin()}
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                border: "none",
                backgroundColor: NAVY,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: pinBusyId === "__new__" ? "wait" : "pointer",
              }}
              data-testid="mgmt-pin-create-save"
            >
              {pinBusyId === "__new__" ? "Saving…" : "Create PIN"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {CAP_LABELS.map(({ key, label }) => (
              <label
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: TEXT,
                }}
              >
                <input
                  type="checkbox"
                  checked={newPermissions[key]}
                  onChange={(e) =>
                    setNewPermissions((prev) => ({
                      ...prev,
                      [key]: e.target.checked,
                    }))
                  }
                  data-testid={`mgmt-pin-new-cap-${key}`}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
