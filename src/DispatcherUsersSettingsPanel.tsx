import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { DispatcherAccountSummary } from "./dispatcher/models";
import {
  deactivateDispatcherClient,
  listDispatchersClient,
  provisionDispatcherClient,
} from "./phase2CallableClients";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "#333";
const MUTED = "#6b7280";
const NAVY = "#0a3161";
const RED = "#bf0a30";

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccd0d7",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "#fff",
  fontFamily: FONT,
};

export function DispatcherUsersSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [dispatchers, setDispatchers] = useState<DispatcherAccountSummary[]>(
    [],
  );
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [grantManager, setGrantManager] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTempPassword, setLastTempPassword] = useState<string | null>(
    null,
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDispatchersClient();
      setDispatchers(result.dispatchers);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load dispatcher accounts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);
    setMessage(null);
    setLastTempPassword(null);
    try {
      const result = await provisionDispatcherClient({
        email: newEmail.trim(),
        temporaryPassword: newPassword.trim() || undefined,
        manager: grantManager,
      });
      setMessage(
        `Dispatcher account created for ${result.email}. Share the temporary password securely.`,
      );
      setLastTempPassword(result.temporaryPassword);
      setNewEmail("");
      setNewPassword("");
      setGrantManager(false);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create dispatcher account.",
      );
    } finally {
      setProvisioning(false);
    }
  };

  const handleDeactivate = async (uid: string) => {
    setBusyUid(uid);
    setError(null);
    setMessage(null);
    try {
      await deactivateDispatcherClient({ uid });
      setMessage("Dispatcher account deactivated.");
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to deactivate account.",
      );
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div data-testid="dispatcher-users-settings-panel">
      <div
        style={{
          padding: "15px 20px",
          borderBottom: "1px solid #eaecf0",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
          Dispatcher accounts
        </span>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: MUTED }}>
          Manager-only — create Firebase Auth dispatcher logins. Office receivers
          are not Auth accounts.
        </p>
      </div>

      <div style={{ padding: "16px 20px" }}>
        {loading && (
          <p style={{ color: MUTED, fontSize: 14 }}>Loading accounts…</p>
        )}
        {error && (
          <p
            data-testid="dispatcher-users-error"
            style={{ color: RED, fontSize: 14, margin: "0 0 12px" }}
          >
            {error}
          </p>
        )}
        {message && (
          <p
            data-testid="dispatcher-users-message"
            style={{ color: "#2e7d32", fontSize: 14, margin: "0 0 12px" }}
          >
            {message}
          </p>
        )}
        {lastTempPassword && (
          <p
            data-testid="dispatcher-users-temp-password"
            style={{
              fontSize: 13,
              color: TEXT,
              background: "#f3f4f6",
              padding: "10px 12px",
              borderRadius: 6,
              margin: "0 0 12px",
              fontFamily: "monospace",
            }}
          >
            Temporary password: {lastTempPassword}
          </p>
        )}

        {!loading && dispatchers.length > 0 && (
          <table
            data-testid="dispatcher-users-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: MUTED }}>
                <th style={{ padding: "8px 6px" }}>Email</th>
                <th style={{ padding: "8px 6px" }}>Role</th>
                <th style={{ padding: "8px 6px" }}>Status</th>
                <th style={{ padding: "8px 6px" }}></th>
              </tr>
            </thead>
            <tbody>
              {dispatchers.map((row) => (
                <tr
                  key={row.uid}
                  data-testid={`dispatcher-user-row-${row.uid}`}
                  style={{ borderTop: "1px solid #eaecf0" }}
                >
                  <td style={{ padding: "10px 6px", color: TEXT }}>
                    {row.email ?? row.uid}
                  </td>
                  <td style={{ padding: "10px 6px", color: TEXT }}>
                    {row.manager ? "Manager" : "Dispatcher"}
                  </td>
                  <td style={{ padding: "10px 6px", color: TEXT }}>
                    {row.active ? "Active" : "Inactive"}
                  </td>
                  <td style={{ padding: "10px 6px" }}>
                    {row.active && (
                      <button
                        type="button"
                        data-testid={`dispatcher-deactivate-${row.uid}`}
                        disabled={busyUid === row.uid}
                        onClick={() => void handleDeactivate(row.uid)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: `1px solid ${RED}`,
                          background: "#fff",
                          color: RED,
                          fontSize: 13,
                          cursor: "pointer",
                          fontFamily: FONT,
                        }}
                      >
                        {busyUid === row.uid ? "…" : "Deactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div
          data-testid="dispatcher-users-provision-form"
          style={{
            borderTop: dispatchers.length > 0 ? "1px solid #eaecf0" : undefined,
            paddingTop: dispatchers.length > 0 ? 16 : 0,
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 600, color: NAVY }}>
            Add dispatcher
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "flex-end",
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: MUTED }}>Email</span>
              <input
                data-testid="dispatcher-provision-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={{ ...inputStyle, minWidth: 220 }}
                placeholder="dispatcher@example.com"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: MUTED }}>
                Temp password (optional)
              </span>
              <input
                data-testid="dispatcher-provision-password"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ ...inputStyle, minWidth: 180 }}
                placeholder="Auto-generated if blank"
              />
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                color: TEXT,
                paddingBottom: 8,
              }}
            >
              <input
                data-testid="dispatcher-provision-manager"
                type="checkbox"
                checked={grantManager}
                onChange={(e) => setGrantManager(e.target.checked)}
              />
              Manager
            </label>
            <button
              type="button"
              data-testid="dispatcher-provision-submit"
              disabled={provisioning || !newEmail.trim()}
              onClick={() => void handleProvision()}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: NAVY,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT,
                opacity: provisioning || !newEmail.trim() ? 0.6 : 1,
              }}
            >
              {provisioning ? "Creating…" : "Create account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
