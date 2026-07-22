import { useCallback, useEffect, useState } from "react";
import type { Job, Technician } from "./dispatcher/models";
import {
  createTechnician,
  listJobs,
  listTechnicians,
  updateTechnician,
} from "./dispatcher/firestoreService";
import { releaseJobsToTechnicianClient } from "./phase2CallableClients";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

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
    if (!releaseTechnicianId || releaseJobIds.size === 0) {
      setReleaseMessage("Select a technician and at least one job.");
      return;
    }
    setReleasing(true);
    setReleaseMessage(null);
    try {
      const result = await releaseJobsToTechnicianClient({
        technicianId: releaseTechnicianId,
        jobIds: [...releaseJobIds],
      });
      setReleaseMessage(
        `Released ${result.jobIds.length} job(s) for today (${result.releaseDate}).`,
      );
      setReleaseJobIds(new Set());
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

  return (
    <div
      style={{
        border: "1.5px solid #ccd0d7",
        borderRadius: 8,
        backgroundColor: "#fff",
        marginBottom: 24,
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
          <p style={{ fontSize: 14, color: "#6b7280" }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
              Per-tech PINs unlock the technician door on any location QR.
              Release jobs for today so techs see directed spots (always-strict).
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
              {technicians.map((tech) => (
                <li
                  key={tech.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid #f3f4f6",
                    fontSize: 14,
                  }}
                >
                  <span>
                    {tech.name}
                    {tech.active === false ? " (inactive)" : ""}
                    {tech.pinCode || tech.pinHash ? " · PIN configured" : ""}
                  </span>
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
                </li>
              ))}
              {technicians.length === 0 && (
                <li style={{ fontSize: 14, color: "#6b7280" }}>
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
                style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ccd0d7" }}
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="4-digit PIN"
                value={techPin}
                onChange={(e) => setTechPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                style={{ width: 100, padding: "8px 10px", borderRadius: 6, border: "1px solid #ccd0d7" }}
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

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 8px" }}>
              Release jobs for today
            </h3>
            <select
              value={releaseTechnicianId}
              onChange={(e) => setReleaseTechnicianId(e.target.value)}
              style={{
                width: "100%",
                maxWidth: 320,
                padding: "8px 10px",
                marginBottom: 12,
                borderRadius: 6,
                border: "1px solid #ccd0d7",
              }}
            >
              <option value="">Select technician…</option>
              {technicians
                .filter((t) => t.active !== false)
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
              {releasing ? "Releasing…" : "Release selected for today"}
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
