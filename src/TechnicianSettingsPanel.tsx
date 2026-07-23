import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Job, Technician, TechnicianPermissions } from "./dispatcher/models";
import {
  createTechnician,
  getTechnicianDayReleaseForDate,
  listJobs,
  listTechnicians,
  updateTechnician,
} from "./dispatcher/firestoreService";
import { releaseJobsToTechnicianClient } from "./phase2CallableClients";
import {
  technicianCanReceiveReleases,
  technicianCanUseDoor,
  todayReleaseDateUtc,
} from "./dispatcher/technicianReleaseHelpers";

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

const defaultPermissions = (): TechnicianPermissions => ({
  doorScan: true,
  receiveReleases: true,
});

function normalizePermissions(
  permissions?: TechnicianPermissions,
): TechnicianPermissions {
  return {
    doorScan: permissions?.doorScan !== false,
    receiveReleases: permissions?.receiveReleases !== false,
  };
}

export function TechnicianSettingsPanel() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [techName, setTechName] = useState("");
  const [techPin, setTechPin] = useState("");
  const [savingTech, setSavingTech] = useState(false);
  const [techError, setTechError] = useState<string | null>(null);
  const [releaseTechnicianId, setReleaseTechnicianId] = useState("");
  const [releaseJobIds, setReleaseJobIds] = useState<Set<string>>(new Set());
  const [releasing, setReleasing] = useState(false);
  const [releaseMessage, setReleaseMessage] = useState<string | null>(null);
  const [pinEdits, setPinEdits] = useState<Record<string, string>>({});
  const [pinSavingId, setPinSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [techs, allJobs] = await Promise.all([
        listTechnicians(),
        listJobs(),
      ]);
      setTechnicians(
        [...techs].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setJobs(
        [...allJobs].sort((a, b) =>
          (a.jobName ?? a.id).localeCompare(b.jobName ?? b.id),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!releaseTechnicianId) {
      setReleaseJobIds(new Set());
      return;
    }
    let mounted = true;
    void getTechnicianDayReleaseForDate(
      releaseTechnicianId,
      todayReleaseDateUtc(),
    )
      .then((release) => {
        if (!mounted) return;
        setReleaseJobIds(new Set(release?.jobIds ?? []));
      })
      .catch(() => {
        if (mounted) setReleaseJobIds(new Set());
      });
    return () => {
      mounted = false;
    };
  }, [releaseTechnicianId]);

  const handleAddTechnician = async () => {
    const name = techName.trim();
    const pin = techPin.trim();
    if (!name || !/^\d{4}$/.test(pin)) {
      setTechError("Name and 4-digit PIN are required.");
      return;
    }
    setSavingTech(true);
    setTechError(null);
    try {
      const id = `tech-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      await createTechnician({
        id,
        name,
        pinCode: pin,
        active: true,
        permissions: defaultPermissions(),
        createdAt: now,
        updatedAt: now,
      });
      setTechName("");
      setTechPin("");
      await reload();
    } catch {
      setTechError("Could not save technician.");
    } finally {
      setSavingTech(false);
    }
  };

  const toggleReleaseJob = (jobId: string) => {
    setReleaseJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const handleReleaseJobs = async () => {
    if (!releaseTechnicianId) {
      setReleaseMessage("Select a technician.");
      return;
    }
    setReleasing(true);
    setReleaseMessage(null);
    try {
      const jobIds = [...releaseJobIds];
      const result = await releaseJobsToTechnicianClient({
        technicianId: releaseTechnicianId,
        jobIds,
        releaseDate: todayReleaseDateUtc(),
        replace: true,
      });
      setReleaseMessage(
        result.jobIds.length === 0
          ? `Cleared today's release list (${result.releaseDate}).`
          : `Set ${result.jobIds.length} job(s) for today (${result.releaseDate}).`,
      );
    } catch (err) {
      setReleaseMessage(
        err instanceof Error ? err.message : "Release failed.",
      );
    } finally {
      setReleasing(false);
    }
  };

  const toggleTechnicianActive = async (tech: Technician) => {
    await updateTechnician({
      ...tech,
      active: tech.active === false,
      updatedAt: new Date().toISOString(),
    });
    await reload();
  };

  const updateTechnicianPermissions = async (
    tech: Technician,
    patch: Partial<TechnicianPermissions>,
  ) => {
    const permissions = normalizePermissions(tech.permissions);
    await updateTechnician({
      ...tech,
      permissions: { ...permissions, ...patch },
      updatedAt: new Date().toISOString(),
    });
    await reload();
  };

  const saveTechnicianPin = async (tech: Technician) => {
    const pin = (pinEdits[tech.id] ?? "").trim();
    if (!/^\d{4}$/.test(pin)) {
      setTechError("PIN must be exactly 4 digits.");
      return;
    }
    setPinSavingId(tech.id);
    setTechError(null);
    try {
      await updateTechnician({
        ...tech,
        pinCode: pin,
        updatedAt: new Date().toISOString(),
      });
      setPinEdits((prev) => {
        const next = { ...prev };
        delete next[tech.id];
        return next;
      });
      await reload();
    } catch {
      setTechError("Could not update PIN.");
    } finally {
      setPinSavingId(null);
    }
  };

  return (
    <div
      data-testid="technician-settings-panel"
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
        Technicians & day release
      </div>
      <div style={{ padding: 20, fontFamily: FONT }}>
        {loading ? (
          <p style={{ fontSize: 14, color: MUTED }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
              Per-tech PINs unlock the technician door on any location QR.
              Permissions control door scan and whether jobs can be released
              to them. Release jobs for today so techs see directed spots
              (always-strict).
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
              {technicians.map((tech) => {
                const permissions = normalizePermissions(tech.permissions);
                return (
                  <li
                    key={tech.id}
                    data-testid={`technician-row-${tech.id}`}
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
                        <strong>{tech.name}</strong>
                        {tech.active === false ? " (inactive)" : ""}
                        {tech.pinCode || tech.pinHash ? " · PIN configured" : ""}
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleTechnicianActive(tech)}
                        style={{
                          fontSize: 12,
                          color: NAVY,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {tech.active === false ? "Activate" : "Deactivate"}
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
                          data-testid={`technician-perm-door-${tech.id}`}
                          checked={permissions.doorScan !== false}
                          disabled={tech.active === false}
                          onChange={(e) =>
                            void updateTechnicianPermissions(tech, {
                              doorScan: e.target.checked,
                            })
                          }
                        />
                        Door scan
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
                          data-testid={`technician-perm-release-${tech.id}`}
                          checked={permissions.receiveReleases !== false}
                          disabled={tech.active === false}
                          onChange={(e) =>
                            void updateTechnicianPermissions(tech, {
                              receiveReleases: e.target.checked,
                            })
                          }
                        />
                        Receive releases
                      </label>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        marginTop: 8,
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="New 4-digit PIN"
                        data-testid={`technician-pin-input-${tech.id}`}
                        value={pinEdits[tech.id] ?? ""}
                        onChange={(e) =>
                          setPinEdits((prev) => ({
                            ...prev,
                            [tech.id]: e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 4),
                          }))
                        }
                        style={{ ...inputStyle, width: 120 }}
                      />
                      <button
                        type="button"
                        data-testid={`technician-pin-save-${tech.id}`}
                        disabled={
                          pinSavingId === tech.id ||
                          !/^\d{4}$/.test((pinEdits[tech.id] ?? "").trim())
                        }
                        onClick={() => void saveTechnicianPin(tech)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "none",
                          backgroundColor: NAVY,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity:
                            pinSavingId === tech.id ||
                            !/^\d{4}$/.test((pinEdits[tech.id] ?? "").trim())
                              ? 0.6
                              : 1,
                        }}
                      >
                        {pinSavingId === tech.id ? "Saving…" : "Update PIN"}
                      </button>
                    </div>
                    {!technicianCanUseDoor(tech) ? (
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED }}>
                        Door scan disabled — PIN will not unlock the tech door.
                      </p>
                    ) : null}
                    {!technicianCanReceiveReleases(tech) ? (
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                        Receive releases disabled — hidden from release lists.
                      </p>
                    ) : null}
                  </li>
                );
              })}
              {technicians.length === 0 && (
                <li style={{ fontSize: 14, color: MUTED }}>
                  No technicians yet.
                </li>
              )}
            </ul>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 20,
              }}
            >
              <input
                type="text"
                placeholder="Technician name"
                value={techName}
                onChange={(e) => setTechName(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="4-digit PIN"
                value={techPin}
                onChange={(e) =>
                  setTechPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                style={{ ...inputStyle, width: 100 }}
              />
              <button
                type="button"
                disabled={savingTech}
                onClick={() => void handleAddTechnician()}
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
                Add technician
              </button>
            </div>
            {techError && (
              <p style={{ color: "#bf0a30", fontSize: 13 }}>{techError}</p>
            )}

            <h3
              style={{
                fontSize: 15,
                fontWeight: 700,
                margin: "24px 0 8px",
                color: NAVY,
              }}
            >
              Release jobs for today
            </h3>
            <p style={{ fontSize: 12, color: MUTED, margin: "0 0 10px" }}>
              Checked jobs are released for the selected technician today.
              Unchecked jobs are removed when you save.
            </p>
            <select
              value={releaseTechnicianId}
              onChange={(e) => setReleaseTechnicianId(e.target.value)}
              style={{
                ...inputStyle,
                width: "100%",
                maxWidth: 320,
                marginBottom: 12,
              }}
            >
              <option value="">Select technician…</option>
              {technicians
                .filter(technicianCanReceiveReleases)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: 8,
                marginBottom: 12,
              }}
            >
              {jobs.map((job) => (
                <label
                  key={job.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 13,
                    padding: "4px 0",
                    color: TEXT,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={releaseJobIds.has(job.id)}
                    onChange={() => toggleReleaseJob(job.id)}
                  />
                  {job.jobName ?? job.id}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={releasing}
              onClick={() => void handleReleaseJobs()}
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
              {releasing ? "Saving…" : "Save today's release list"}
            </button>
            {releaseMessage && (
              <p style={{ fontSize: 13, marginTop: 8, color: "#374151" }}>
                {releaseMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
