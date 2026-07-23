import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Technician } from "../models";
import {
  listTechnicianDayReleasesForDate,
  listTechnicians,
} from "../firestoreService";
import { resolveTechnicianBadgeStyle } from "../technicianBadgeColors";
import {
  buildJobReleasedToEntries,
  type ReleasedToEntry,
  reassignJobToTechnicianForToday,
  releaseJobToTechnicianForToday,
  technicianCanReceiveReleases,
  todayReleaseDateUtc,
} from "../technicianReleaseHelpers";

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
  const [editMode, setEditMode] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releasedEntries, setReleasedEntries] = useState<ReleasedToEntry[]>(
    [],
  );

  const techById = useMemo(
    () => new Map(technicians.map((t) => [t.id, t])),
    [technicians],
  );

  const isAssigned = releasedEntries.length > 0;
  const showPicker = !loading && (!isAssigned || editMode);

  const reloadReleasedEntries = useCallback(async () => {
    const [techs, releases] = await Promise.all([
      listTechnicians(),
      listTechnicianDayReleasesForDate(todayReleaseDateUtc()),
    ]);
    setTechnicians(
      [...techs].sort((a, b) => a.name.localeCompare(b.name)),
    );
    const entriesMap = buildJobReleasedToEntries(releases, techs);
    setReleasedEntries(entriesMap.get(jobId) ?? []);
  }, [jobId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void reloadReleasedEntries()
      .catch(() => {
        if (mounted) setError("Could not load technician release data.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadReleasedEntries]);

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
      if (isAssigned && editMode) {
        const previousIds = releasedEntries.map((e) => e.technicianId);
        if (previousIds.includes(selectedTechId)) {
          setEditMode(false);
          setSelectedTechId("");
          setMessage(
            tech ? `Still released to ${tech.name} for today.` : null,
          );
          return;
        }
        await reassignJobToTechnicianForToday(
          jobId,
          selectedTechId,
          previousIds,
        );
        setMessage(
          tech
            ? `Reassigned to ${tech.name} for today.`
            : "Job reassigned for today.",
        );
      } else {
        await releaseJobToTechnicianForToday(selectedTechId, jobId);
        setMessage(
          tech
            ? `Released to ${tech.name} for today.`
            : "Job released for today.",
        );
      }
      setEditMode(false);
      setSelectedTechId("");
      await reloadReleasedEntries();
      await onReleased?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed.");
    } finally {
      setReleasing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setSelectedTechId("");
    setError(null);
    setMessage(null);
  };

  const panelBorder =
    releasedEntries.length > 0
      ? resolveTechnicianBadgeStyle(
          techById.get(releasedEntries[0].technicianId) ?? {
            id: releasedEntries[0].technicianId,
          },
        ).border
      : "#c4b5fd";

  return (
    <div
      data-testid="job-release-to-technician-panel"
      style={{
        border: `1px solid ${panelBorder}`,
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
            color: NAVY,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Release to technician
        </span>
        {isAssigned ? (
          <span
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span
              data-testid="job-release-current-badge"
              style={{
                display: "inline-flex",
                flexWrap: "wrap",
                gap: 4,
                alignItems: "center",
              }}
            >
              {releasedEntries.map((entry) => {
                const tech = techById.get(entry.technicianId);
                const badgeStyle = resolveTechnicianBadgeStyle(
                  tech ?? { id: entry.technicianId },
                );
                return (
                  <span
                    key={entry.technicianId}
                    data-testid={`job-release-current-badge-${entry.technicianId}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "3px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      backgroundColor: badgeStyle.bg,
                      color: badgeStyle.text,
                      border: `1px solid ${badgeStyle.border}`,
                    }}
                  >
                    {entry.name}
                  </span>
                );
              })}
            </span>
            {!editMode ? (
              <button
                type="button"
                data-testid="job-release-edit-btn"
                onClick={() => {
                  setEditMode(true);
                  setMessage(null);
                  setError(null);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: `1px solid ${NAVY}`,
                  backgroundColor: "#fff",
                  color: NAVY,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Edit
              </button>
            ) : null}
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
      ) : showPicker ? (
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
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
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
              {releasing
                ? "Saving…"
                : isAssigned && editMode
                  ? "Release"
                  : "Release to technician"}
            </button>
            {isAssigned && editMode ? (
              <button
                type="button"
                data-testid="job-release-cancel-edit"
                disabled={releasing}
                onClick={handleCancelEdit}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #ccd0d7",
                  backgroundColor: "#fff",
                  color: TEXT,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: releasing ? "not-allowed" : "pointer",
                  fontFamily: font,
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </>
      ) : null}

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
