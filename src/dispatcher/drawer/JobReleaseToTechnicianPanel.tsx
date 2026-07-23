import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Technician } from "../models";
import {
  listTechnicianDayReleasesForDate,
  listTechnicians,
} from "../firestoreService";
import {
  releasedTechnicianNamesForJob,
  releaseJobToTechnicianForToday,
  technicianCanReceiveReleases,
  todayReleaseDateUtc,
} from "../technicianReleaseHelpers";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "#333";
const MUTED = "#6b7280";
const RELEASE_BADGE_BG = "#ede9fe";
const RELEASE_BADGE_TEXT = "#5b21b6";
const RELEASE_BADGE_BORDER = "#c4b5fd";

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccd0d7",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "#fff",
  fontFamily: FONT,
  width: "100%",
};

type Props = {
  jobId: string;
  font: string;
  onReleased?: () => void | Promise<void>;
};

export function JobReleaseToTechnicianPanel({
  jobId,
  font,
  onReleased,
}: Props) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTechId, setSelectedTechId] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releasedToLabel, setReleasedToLabel] = useState("");

  const reloadReleasedLabel = useCallback(async () => {
    const [techs, releases] = await Promise.all([
      listTechnicians(),
      listTechnicianDayReleasesForDate(todayReleaseDateUtc()),
    ]);
    setTechnicians(
      [...techs].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setReleasedToLabel(
      releasedTechnicianNamesForJob(jobId, releases, techs),
    );
  }, [jobId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void reloadReleasedLabel()
      .catch(() => {
        if (mounted) setError("Could not load technician release data.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadReleasedLabel]);

  const eligibleTechnicians = technicians.filter(technicianCanReceiveReleases);

  const handleRelease = async () => {
    if (!selectedTechId) {
      setError("Select a technician.");
      return;
    }
    setReleasing(true);
    setError(null);
    setMessage(null);
    try {
      const tech = technicians.find((t) => t.id === selectedTechId);
      await releaseJobToTechnicianForToday(selectedTechId, jobId);
      setMessage(
        tech
          ? `Released to ${tech.name} for today.`
          : "Job released for today.",
      );
      await reloadReleasedLabel();
      await onReleased?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed.");
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div
      data-testid="job-release-to-technician-panel"
      style={{
        border: `1px solid ${RELEASE_BADGE_BORDER}`,
        borderRadius: 8,
        backgroundColor: "#faf5ff",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        color: TEXT,
        fontFamily: font,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          data-testid="job-release-panel-heading"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: RELEASE_BADGE_TEXT,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Release to technician
        </span>
        {releasedToLabel ? (
          <span
            data-testid="job-release-current-badge"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              backgroundColor: RELEASE_BADGE_BG,
              color: RELEASE_BADGE_TEXT,
              border: `1px solid ${RELEASE_BADGE_BORDER}`,
            }}
          >
            {releasedToLabel}
          </span>
        ) : (
          <span
            data-testid="job-release-current-empty"
            style={{ fontSize: 12, color: MUTED }}
          >
            Not released today
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Loading…</p>
      ) : (
        <>
          <select
            data-testid="job-release-technician-select"
            value={selectedTechId}
            onChange={(e) => setSelectedTechId(e.target.value)}
            style={inputStyle}
          >
            <option value="">Select technician…</option>
            {eligibleTechnicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {eligibleTechnicians.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
              Add an active technician in Settings first.
            </p>
          ) : null}
          <button
            type="button"
            data-testid="job-release-submit"
            disabled={releasing || !selectedTechId}
            onClick={() => void handleRelease()}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border:
                releasing || !selectedTechId
                  ? "2px solid #6b7280"
                  : "2px solid transparent",
              backgroundColor:
                releasing || !selectedTechId ? "#fff" : NAVY,
              color: releasing || !selectedTechId ? "#374151" : "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor:
                releasing || !selectedTechId ? "not-allowed" : "pointer",
              fontFamily: font,
            }}
          >
            {releasing ? "Releasing…" : "Release to technician"}
          </button>
        </>
      )}

      {message ? (
        <p
          data-testid="job-release-success"
          style={{ margin: 0, fontSize: 13, color: "#166534", fontWeight: 600 }}
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          data-testid="job-release-error"
          style={{ margin: 0, fontSize: 13, color: "#bf0a30" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const RELEASED_TO_TABLE_BADGE = {
  bg: RELEASE_BADGE_BG,
  text: RELEASE_BADGE_TEXT,
  border: RELEASE_BADGE_BORDER,
} as const;
