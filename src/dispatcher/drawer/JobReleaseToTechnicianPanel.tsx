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
  unassignJobFromTechniciansForToday,
} from "../technicianReleaseHelpers";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TEXT = "var(--admin-text)";
const MUTED = "var(--admin-text-muted)";

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--admin-border)",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "var(--admin-surface)",
  fontFamily: FONT,
  width: "100%",
};

const fullWidthActionBase = (
  font: string,
): Pick<
  CSSProperties,
  | "width"
  | "padding"
  | "borderRadius"
  | "fontSize"
  | "fontWeight"
  | "letterSpacing"
  | "fontFamily"
  | "boxSizing"
> => ({
  width: "100%",
  padding: "12px 16px",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: "0.03em",
  fontFamily: font,
  boxSizing: "border-box",
});

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
  const showAssignedBar = !loading && isAssigned && !editMode;

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

  const handleUnassign = async () => {
    const previousIds = releasedEntries.map((e) => e.technicianId);
    if (previousIds.length === 0) return;
    setReleasing(true);
    setError(null);
    setMessage(null);
    try {
      await unassignJobFromTechniciansForToday(jobId, previousIds);
      setEditMode(false);
      setSelectedTechId("");
      setMessage("Unassigned from technician for today.");
      await reloadReleasedEntries();
      await onReleased?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unassign failed.");
    } finally {
      setReleasing(false);
    }
  };

  const actionBase = fullWidthActionBase(font);
  const releaseDisabled = releasing || !selectedTechId;

  return (
    <div
      data-testid="job-release-to-technician-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        color: TEXT,
        fontFamily: font,
      }}
    >
      {showAssignedBar ? (
        <div
          data-testid="job-release-assigned-bar"
          style={{
            ...actionBase,
            border: `2px solid ${NAVY}`,
            backgroundColor: NAVY,
            color: "var(--admin-on-navy)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
            boxShadow: "0 2px 8px rgba(10, 49, 97, 0.25)",
          }}
        >
          <span
            data-testid="job-release-panel-heading"
            style={{
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              color: "var(--admin-text)",
            }}
          >
            Release to technician
          </span>
          <span
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
              marginLeft: "auto",
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
            <button
              type="button"
              data-testid="job-release-edit-btn"
              onClick={() => {
                setEditMode(true);
                setMessage(null);
                setError(null);
              }}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.55)",
                backgroundColor: "rgba(255,255,255,0.14)",
                color: "var(--admin-text)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Edit
            </button>
          </span>
        </div>
      ) : null}

      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Loading…</p>
      ) : showPicker ? (
        <>
          {isAssigned && editMode ? (
            <span
              data-testid="job-release-panel-heading"
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                color: "var(--admin-accent-soft)",
                letterSpacing: "0.02em",
              }}
            >
              Change technician
            </span>
          ) : null}
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
              flexDirection: "column",
              gap: 8,
              width: "100%",
            }}
          >
            <button
              type="button"
              data-testid="job-release-submit"
              disabled={releaseDisabled}
              onClick={() => void handleRelease()}
              style={{
                ...actionBase,
                border: `2px solid ${NAVY}`,
                backgroundColor: releaseDisabled ? "var(--admin-border)" : NAVY,
                color: releaseDisabled ? "var(--admin-text-muted)" : "var(--admin-text)",
                cursor: releaseDisabled ? "not-allowed" : "pointer",
                boxShadow: releaseDisabled
                  ? "none"
                  : "0 2px 8px rgba(10, 49, 97, 0.25)",
                opacity: 1,
                transition: "transform 0.1s ease, box-shadow 0.15s ease",
              }}
            >
              {releasing
                ? "Saving…"
                : isAssigned && editMode
                  ? "Release"
                  : "Release to technician"}
            </button>
            {isAssigned && editMode ? (
              <>
                <button
                  type="button"
                  data-testid="job-release-unassign"
                  disabled={releasing}
                  onClick={() => void handleUnassign()}
                  style={{
                    ...actionBase,
                    padding: "10px 14px",
                    border: "1px solid #bf0a30",
                    backgroundColor: releasing ? "var(--admin-border)" : "var(--admin-surface)",
                    color: releasing ? "var(--admin-text-muted)" : "#bf0a30",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: releasing ? "not-allowed" : "pointer",
                    boxShadow: "none",
                  }}
                >
                  {releasing ? "Saving…" : "Unassign"}
                </button>
                <button
                  type="button"
                  data-testid="job-release-cancel-edit"
                  disabled={releasing}
                  onClick={handleCancelEdit}
                  style={{
                    ...actionBase,
                    padding: "10px 14px",
                    border: "1px solid var(--admin-border)",
                    backgroundColor: "var(--admin-surface)",
                    color: TEXT,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: releasing ? "not-allowed" : "pointer",
                    boxShadow: "none",
                  }}
                >
                  Cancel
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {message ? (
        <p
          data-testid="job-release-success"
          style={{ margin: 0, fontSize: 13, color: "var(--admin-success-text)", fontWeight: 600 }}
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
