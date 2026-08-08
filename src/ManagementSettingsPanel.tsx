import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { StagingLocation } from "./dispatcher/models";
import {
  getAppSettings,
  listAllZones,
  updateAppSettings,
} from "./dispatcher/firestoreService";
import { sortStagingLocationsForList } from "./dispatcher/stagingMapSync";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "var(--admin-text)";
const MUTED = "var(--admin-text-muted)";
const NAVY = "#0a3161";

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--admin-border)",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "var(--admin-surface)",
  fontFamily: FONT,
};

export function ManagementSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [spots, setSpots] = useState<StagingLocation[]>([]);
  const [catchAllStagingLocationId, setCatchAllStagingLocationId] = useState("");
  const [parcelIntakeEnabled, setParcelIntakeEnabled] = useState(false);
  const [managementSessionMinutes, setManagementSessionMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
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
      setSpots(sortStagingLocationsForList(locations));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(reload);
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

  if (loading) {
    return (
      <p style={{ fontSize: 14, color: MUTED, padding: 16 }}>
        Loading management settings…
      </p>
    );
  }

  return (
    <div style={{ padding: 24 }} data-testid="management-settings-panel">
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: "0 0 8px" }}>
        Catch-all parcel intake (Phase 6)
      </h2>
      <p
        style={{
          fontSize: 13,
          color: MUTED,
          margin: "0 0 16px",
          maxWidth: 640,
        }}
      >
        Assign a dedicated staging spot for office parcel drops. Office staff
        scan any location QR and enter a management PIN. PINs and capabilities
        are managed in PIN &amp; Access Management above.
      </p>

      {error && (
        <p
          style={{ fontSize: 13, color: "var(--admin-danger-text)", marginBottom: 12 }}
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          style={{
            fontSize: 13,
            color: "var(--admin-success-text)",
            marginBottom: 12,
          }}
          role="status"
        >
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
          onChange={(event) =>
            setCatchAllStagingLocationId(event.target.value)
          }
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
            onChange={(event) =>
              setParcelIntakeEnabled(event.target.checked)
            }
            data-testid="mgmt-parcel-intake-enabled"
          />
          Enable parcel intake
        </label>
        <label style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>
          PIN session length (min, absolute TTL)
        </label>
        <input
          type="number"
          min={5}
          max={480}
          value={managementSessionMinutes}
          onChange={(event) =>
            setManagementSessionMinutes(Number(event.target.value) || 30)
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
            color: "var(--admin-on-navy)",
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? "wait" : "pointer",
          }}
          data-testid="mgmt-catch-all-save"
        >
          {saving ? "Saving…" : "Save intake config"}
        </button>
      </div>
    </div>
  );
}
