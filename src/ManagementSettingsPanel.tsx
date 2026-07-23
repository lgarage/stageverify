import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { StagingLocation } from "./dispatcher/models";
import {
  getAppSettings,
  listAllZones,
  updateAppSettings,
} from "./dispatcher/firestoreService";
import { setManagementPinClient } from "./phase2CallableClients";

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

export function ManagementSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [spots, setSpots] = useState<StagingLocation[]>([]);
  const [catchAllStagingLocationId, setCatchAllStagingLocationId] = useState("");
  const [parcelIntakeEnabled, setParcelIntakeEnabled] = useState(false);
  const [managementSessionMinutes, setManagementSessionMinutes] = useState(30);
  const [hasManagementPin, setHasManagementPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, locations] = await Promise.all([
        getAppSettings(),
        listAllZones(),
      ]);
      setCatchAllStagingLocationId(settings.catchAllStagingLocationId ?? "");
      setParcelIntakeEnabled(settings.parcelIntakeEnabled === true);
      setManagementSessionMinutes(settings.managementSessionMinutes ?? 30);
      setHasManagementPin(
        settings.managementPinConfigured === true ||
          Boolean(settings.managementPinHash?.trim()),
      );
      setSpots(
        [...locations].sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true }),
        ),
      );
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

  const saveManagementPin = async () => {
    const pin = newPin.trim();
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit management PIN.");
      return;
    }
    setPinSaving(true);
    setError(null);
    setMessage(null);
    try {
      await setManagementPinClient({ pin });
      setHasManagementPin(true);
      setNewPin("");
      setMessage("Management PIN updated.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set management PIN.",
      );
    } finally {
      setPinSaving(false);
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
    <div style={{ padding: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: "0 0 8px" }}>
        Catch-all parcel intake (Phase 6)
      </h2>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px", maxWidth: 560 }}>
        Assign a dedicated staging spot for office parcel drops. Scan that location QR
        and enter the shared management PIN to mark expected deliveries received.
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
            backgroundColor: "#0a3161",
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
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>
          Management PIN
        </label>
        <span style={{ fontSize: 13, color: MUTED }}>
          {hasManagementPin ? "Configured" : "Not set"}
        </span>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="New 4-digit PIN"
          value={newPin}
          onChange={(e) =>
            setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          style={{ ...inputStyle, width: 140 }}
          data-testid="mgmt-pin-input"
        />
        <button
          type="button"
          disabled={pinSaving}
          onClick={() => void saveManagementPin()}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "#0a3161",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: pinSaving ? "wait" : "pointer",
          }}
          data-testid="mgmt-pin-save"
        >
          {pinSaving ? "Saving…" : "Set PIN"}
        </button>
      </div>
    </div>
  );
}
