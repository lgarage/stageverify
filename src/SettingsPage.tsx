import { useState, useEffect, useMemo, type CSSProperties, type FormEvent } from "react";
import { Navigate, Link, useLocation } from "react-router-dom";
import {
  LOCATION_STATUSES,
  type LocationStatus,
  type StagingLocation,
} from "./dispatcher/models";
import {
  findStagingLocationByCode,
  formatStagingCodeCanonical,
} from "./dispatcher/stagingCode";
import {
  getAppSettings,
  updateAppSettings,
  listAllZones,
  createZone,
  updateZone,
} from "./dispatcher/firestoreService";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_TOPBAR_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { portalNavFocus } from "./dispatcherPortalNav";
import { PortalSidebar } from "./PortalSidebar";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STAGING_SPOT_TYPES = ["ground", "shelf", "bin", "other"] as const;
type StagingSpotType = (typeof STAGING_SPOT_TYPES)[number];

const STAGING_TYPE_LABELS: Record<StagingSpotType, string> = {
  ground: "Ground",
  shelf: "Shelf",
  bin: "Bin",
  other: "Other",
};

const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  Planned: "Planned (inactive)",
  Installed: "Installed",
  Tagged: "Tagged",
  Active: "Active",
};

type StagingSpotEditForm = {
  code: string;
  label: string;
  type: StagingSpotType;
  status: LocationStatus;
  sortOrder: string;
};

function spotToEditForm(spot: StagingLocation): StagingSpotEditForm {
  return {
    code: spot.code,
    label: spot.label,
    type: spot.type as StagingSpotType,
    status: spot.status,
    sortOrder: spot.sortOrder != null ? String(spot.sortOrder) : "",
  };
}

function findOtherSpotByCode(
  spots: StagingLocation[],
  code: string,
  excludeId: string,
): StagingLocation | undefined {
  const found = findStagingLocationByCode(spots, code);
  if (!found || found.id === excludeId) return undefined;
  return found;
}

function defaultDimensionsForSpotType(type: StagingSpotType): {
  widthFt?: number;
  depthFt?: number;
} {
  if (type === "shelf" || type === "bin") return { widthFt: 3, depthFt: 3 };
  if (type === "ground") return { widthFt: 4, depthFt: 4 };
  return {};
}

function sortStagingSpots(a: StagingLocation, b: StagingLocation): number {
  const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

export function SettingsPage() {
  const location = useLocation();
  const [revertWindowMinutes, setRevertWindowMinutes] = useState(60);
  const [savingRevert, setSavingRevert] = useState(false);
  const [revertSaved, setRevertSaved] = useState(false);

  const [stagingSpots, setStagingSpots] = useState<StagingLocation[]>([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [spotCode, setSpotCode] = useState("");
  const [spotLabel, setSpotLabel] = useState("");
  const [spotType, setSpotType] = useState<StagingSpotType>("ground");
  const [spotSortOrder, setSpotSortOrder] = useState("");
  const [savingSpot, setSavingSpot] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [spotSaved, setSpotSaved] = useState(false);

  const [editingSpotId, setEditingSpotId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<StagingSpotEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingSpots(true);
    void listAllZones()
      .then((spots) => setStagingSpots([...spots].sort(sortStagingSpots)))
      .finally(() => setLoadingSpots(false));
  }, []);

  useEffect(() => {
    void getAppSettings().then((settings) => {
      setRevertWindowMinutes(settings.vendorRevertWindowMinutes);
    });
  }, []);

  const saveRevertWindow = async () => {
    if (savingRevert) return;
    setSavingRevert(true);
    try {
      await updateAppSettings({
        vendorRevertWindowMinutes: revertWindowMinutes,
      });
      setRevertSaved(true);
      setTimeout(() => setRevertSaved(false), 2000);
    } finally {
      setSavingRevert(false);
    }
  };

  const handleAddStagingSpot = async (e: FormEvent) => {
    e.preventDefault();
    const label = spotLabel.trim();
    if (!spotCode.trim() || !label || savingSpot) return;

    const canonicalCode = formatStagingCodeCanonical(spotCode);
    if (findStagingLocationByCode(stagingSpots, spotCode)) {
      setSpotError(`Spot code "${canonicalCode}" already exists.`);
      return;
    }

    setSavingSpot(true);
    setSpotError(null);
    setSpotSaved(false);

    try {
      const sortOrder = spotSortOrder.trim()
        ? Number(spotSortOrder)
        : undefined;
      const dims = defaultDimensionsForSpotType(spotType);
      const id = await createZone({
        code: canonicalCode,
        label,
        type: spotType,
        status: "Active",
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
        ...dims,
      });
      const newSpot: StagingLocation = {
        id,
        code: canonicalCode,
        label,
        type: spotType,
        status: "Active",
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
        ...dims,
      };
      setStagingSpots((prev) =>
        [...prev, newSpot].sort(sortStagingSpots),
      );
      setSpotCode("");
      setSpotLabel("");
      setSpotType("ground");
      setSpotSortOrder("");
      setSpotSaved(true);
      window.setTimeout(() => setSpotSaved(false), 2500);
    } catch (err) {
      setSpotError(
        err instanceof Error ? err.message : "Failed to add staging spot.",
      );
    } finally {
      setSavingSpot(false);
    }
  };

  const cardStyle = {
    backgroundColor: "#fff",
    border: "1px solid #dde1e7",
    borderRadius: 8,
    boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
  };

  const existingSpotCodes = useMemo(
    () => stagingSpots.map((s) => s.code.trim()).filter(Boolean),
    [stagingSpots],
  );

  const spotCodeConflict =
    spotCode.trim().length > 0 &&
    findStagingLocationByCode(stagingSpots, spotCode) !== undefined;

  const conflictingSpot = useMemo(
    () =>
      spotCode.trim()
        ? findStagingLocationByCode(stagingSpots, spotCode)
        : undefined,
    [spotCode, stagingSpots],
  );

  const startEditSpot = (spot: StagingLocation) => {
    setEditingSpotId(spot.id);
    setEditForm(spotToEditForm(spot));
    setEditError(null);
    setSpotError(null);
  };

  const cancelEditSpot = () => {
    setEditingSpotId(null);
    setEditForm(null);
    setEditError(null);
  };

  const saveEditSpot = async (spot: StagingLocation) => {
    if (editingSpotId !== spot.id || !editForm || savingEdit) return;

    const label = editForm.label.trim();
    if (!editForm.code.trim() || !label) return;

    const canonicalCode = formatStagingCodeCanonical(editForm.code);
    if (findOtherSpotByCode(stagingSpots, editForm.code, spot.id)) {
      setEditError(`Spot code "${canonicalCode}" is already used.`);
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      const sortOrder = editForm.sortOrder.trim()
        ? Number(editForm.sortOrder)
        : undefined;
      const patch = {
        code: canonicalCode,
        label,
        type: editForm.type,
        status: editForm.status,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
      };
      await updateZone(spot.id, patch);
      setStagingSpots((prev) =>
        prev
          .map((s) => (s.id === spot.id ? { ...s, ...patch, id: spot.id } : s))
          .sort(sortStagingSpots),
      );
      cancelEditSpot();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to save staging spot.",
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid #ccd0d7",
    borderRadius: 6,
    fontSize: 14,
    color: "#333",
    outline: "none",
    backgroundColor: "#fff",
    fontFamily: FONT,
    boxSizing: "border-box",
  };

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "#6b7280",
    marginBottom: 6,
  };

  if (portalNavFocus(location.search) === "vendors") {
    return <Navigate to="/vendors" replace />;
  }

  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
      <PortalSidebar />
      {/* Main content */}
      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "#f0f2f5" }}
      >
        <div
          className={PORTAL_TOPBAR_CLASS}
          style={{
            backgroundColor: "#fff",
            borderBottom: "1px solid #e0e3e8",
            height: 52,
            padding: "0 20px",
            boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: NAVY, fontWeight: 700, fontSize: 15 }}>
              Settings
            </span>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>
              / Configuration
            </span>
          </div>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              backgroundColor: NAVY,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            D
          </div>
        </div>

        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "#f0f2f5" }}
        >
        <div
          style={{
            padding: "30px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
            maxWidth: 1440,
            margin: "0 auto",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: NAVY,
                margin: 0,
                lineHeight: "1.2",
              }}
            >
              Settings
            </h1>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              Manage staging spots and workflow configuration.
            </p>
          </div>

          {/* Workflow settings */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                Workflow
              </span>
            </div>
            <div
              style={{
                padding: "20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#6b7280",
                  whiteSpace: "nowrap",
                }}
              >
                Vendor auto-save
              </label>
              <input
                type="number"
                min={1}
                value={revertWindowMinutes}
                onChange={(e) =>
                  setRevertWindowMinutes(Number(e.target.value) || 0)
                }
                onBlur={() => void saveRevertWindow()}
                style={{
                  width: 80,
                  padding: "10px 12px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#333",
                  outline: "none",
                  backgroundColor: "#fff",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: "#6b7280" }}>minutes</span>
              <button
                type="button"
                onClick={() => void saveRevertWindow()}
                disabled={savingRevert}
                style={{
                  padding: "8px 18px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: savingRevert ? "#f3f4f6" : NAVY,
                  color: savingRevert ? "#9ca3af" : "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: savingRevert ? "not-allowed" : "pointer",
                  fontFamily: FONT,
                  outline: "none",
                }}
              >
                Save
              </button>
              {revertSaved && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#2e7d32",
                  }}
                >
                  Saved ✓
                </span>
              )}
            </div>
          </div>

          {/* Staging spots */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                  Staging Spots
                </span>
                {!loadingSpots && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: "#9ca3af",
                      fontWeight: 500,
                    }}
                  >
                    {stagingSpots.length}{" "}
                    {stagingSpots.length === 1 ? "spot" : "spots"} listed
                  </span>
                )}
              </div>
              <Link
                to="/zones"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: NAVY,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Zone map &amp; QR labels →
              </Link>
            </div>
            <div style={{ padding: "20px" }}>
              <p
                style={{
                  margin: "0 0 16px",
                  fontSize: 12,
                  color: "#6b7280",
                  lineHeight: 1.45,
                  maxWidth: 560,
                }}
              >
                Spots already in the system appear below. Use{" "}
                <strong style={{ fontWeight: 700 }}>Edit</strong> to change label,
                type, status, or sort order. Add new ones with a code that is not
                already listed. A top-down shop map will come later — for now spots
                appear in vendor check-in and dispatcher assignment.
              </p>

              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#374151",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Already listed
              </p>

              {loadingSpots ? (
                <p style={{ fontSize: 13, color: "#9ca3af", margin: "0 0 16px" }}>
                  Loading spots…
                </p>
              ) : stagingSpots.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    margin: "0 0 16px",
                    padding: "12px 14px",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #eaecf0",
                    borderRadius: 6,
                  }}
                >
                  No staging spots listed yet. Add the first one below.
                </p>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                    marginBottom: 12,
                    border: "1px solid #eaecf0",
                    borderRadius: 6,
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      minWidth: 420,
                      borderCollapse: "collapse",
                      fontSize: 13,
                      fontFamily: FONT,
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: NAVY }}>
                        {["Code", "Label", "Type", "Status", "Sort", ""].map(
                          (col, i) => (
                            <th
                              key={i}
                              style={{
                                padding: "12px",
                                fontWeight: 700,
                                fontSize: 14,
                                color: "#ffffff",
                                textAlign: "left",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {col}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {stagingSpots.map((spot, idx) => {
                        const isEditing = editingSpotId === spot.id;
                        const rowBg = idx % 2 === 0 ? "#fff" : "#fafbfc";
                        const tdBase: CSSProperties = {
                          padding: "10px 12px",
                          borderBottom: "1px solid #eaecf0",
                          verticalAlign: "middle",
                        };
                        const inlineInput: CSSProperties = {
                          padding: "4px 8px",
                          border: "1.5px solid #ccd0d7",
                          borderRadius: 4,
                          fontSize: 13,
                          color: "#333",
                          fontFamily: FONT,
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                          backgroundColor: "#fff",
                        };
                        const rowConflict =
                          isEditing &&
                          editForm &&
                          findOtherSpotByCode(
                            stagingSpots,
                            editForm.code,
                            spot.id,
                          ) !== undefined;
                        const saveDisabled =
                          savingEdit ||
                          !editForm?.code.trim() ||
                          !editForm?.label.trim() ||
                          Boolean(rowConflict);

                        return (
                          <tr key={spot.id} style={{ backgroundColor: rowBg }}>
                            <td
                              style={{
                                ...tdBase,
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: NAVY,
                              }}
                            >
                              {isEditing && editForm ? (
                                <input
                                  style={{
                                    ...inlineInput,
                                    border: rowConflict
                                      ? `1.5px solid ${RED}`
                                      : inlineInput.border,
                                  }}
                                  value={editForm.code}
                                  onChange={(e) => {
                                    setEditForm((f) =>
                                      f ? { ...f, code: e.target.value } : f,
                                    );
                                    setEditError(null);
                                  }}
                                  autoFocus
                                />
                              ) : (
                                spot.code
                              )}
                            </td>
                            <td
                              data-testid={`spot-label-${spot.code}`}
                              style={{ ...tdBase, color: "#333" }}
                            >
                              {isEditing && editForm ? (
                                <input
                                  data-testid="edit-spot-label"
                                  style={inlineInput}
                                  value={editForm.label}
                                  onChange={(e) => {
                                    setEditForm((f) =>
                                      f ? { ...f, label: e.target.value } : f,
                                    );
                                    setEditError(null);
                                  }}
                                />
                              ) : (
                                spot.label
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "#333" }}>
                              {isEditing && editForm ? (
                                <select
                                  style={inlineInput}
                                  value={editForm.type}
                                  onChange={(e) =>
                                    setEditForm((f) =>
                                      f
                                        ? {
                                            ...f,
                                            type: e.target
                                              .value as StagingSpotType,
                                          }
                                        : f,
                                    )
                                  }
                                >
                                  {STAGING_SPOT_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {STAGING_TYPE_LABELS[t]}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                STAGING_TYPE_LABELS[spot.type]
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "#333" }}>
                              {isEditing && editForm ? (
                                <select
                                  style={inlineInput}
                                  value={editForm.status}
                                  onChange={(e) =>
                                    setEditForm((f) =>
                                      f
                                        ? {
                                            ...f,
                                            status: e.target
                                              .value as LocationStatus,
                                          }
                                        : f,
                                    )
                                  }
                                >
                                  {LOCATION_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {LOCATION_STATUS_LABEL[s]}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  style={{
                                    color:
                                      spot.status === "Active"
                                        ? "#2e7d32"
                                        : "#6b7280",
                                    fontWeight: 600,
                                  }}
                                >
                                  {spot.status}
                                </span>
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "#333" }}>
                              {isEditing && editForm ? (
                                <input
                                  type="number"
                                  min={0}
                                  style={{ ...inlineInput, width: 72 }}
                                  value={editForm.sortOrder}
                                  onChange={(e) =>
                                    setEditForm((f) =>
                                      f
                                        ? { ...f, sortOrder: e.target.value }
                                        : f,
                                    )
                                  }
                                  placeholder="—"
                                />
                              ) : spot.sortOrder != null ? (
                                spot.sortOrder
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ ...tdBase, whiteSpace: "nowrap" }}>
                              {isEditing ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    type="button"
                                    data-testid={`save-spot-${spot.code}`}
                                    onClick={() => void saveEditSpot(spot)}
                                    disabled={saveDisabled}
                                    style={{
                                      padding: "3px 10px",
                                      borderRadius: 4,
                                      border: "none",
                                      backgroundColor: saveDisabled
                                        ? "#e5e7eb"
                                        : NAVY,
                                      color: saveDisabled ? "#9ca3af" : "#fff",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: saveDisabled
                                        ? "not-allowed"
                                        : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    {savingEdit ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditSpot}
                                    disabled={savingEdit}
                                    style={{
                                      padding: "3px 10px",
                                      borderRadius: 4,
                                      border: "1.5px solid #ccd0d7",
                                      backgroundColor: "#fff",
                                      color: "#6b7280",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: savingEdit
                                        ? "not-allowed"
                                        : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`edit-spot-${spot.code}`}
                                  onClick={() => startEditSpot(spot)}
                                  style={{
                                    padding: "3px 10px",
                                    borderRadius: 4,
                                    border: "1.5px solid #0a3161",
                                    backgroundColor: "#fff",
                                    color: "#0a3161",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    fontFamily: FONT,
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {editError && (
                <p
                  style={{
                    margin: "0 0 16px",
                    fontSize: 13,
                    color: RED,
                    fontWeight: 600,
                  }}
                >
                  {editError}
                </p>
              )}

              {!loadingSpots && stagingSpots.length > 0 && (
                <div
                  style={{
                    marginBottom: 20,
                    padding: "12px 14px",
                    backgroundColor: "#f0f4fa",
                    border: "1px solid #c5d4e8",
                    borderRadius: 6,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      color: NAVY,
                    }}
                  >
                    {stagingSpots.length}{" "}
                    {stagingSpots.length === 1 ? "spot" : "spots"} already listed
                  </p>
                  <p
                    style={{
                      margin: "4px 0 10px",
                      fontSize: 11,
                      color: "#6b7280",
                      lineHeight: 1.45,
                    }}
                  >
                    Use a new code when adding — duplicates are blocked.
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {stagingSpots.map((spot) => (
                      <li
                        key={spot.id}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "baseline",
                          gap: "6px 10px",
                          fontSize: 13,
                          color: "#374151",
                          lineHeight: 1.4,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            color: NAVY,
                            minWidth: 48,
                          }}
                        >
                          {spot.code}
                        </span>
                        <span style={{ color: "#6b7280" }}>—</span>
                        <span>{spot.label}</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#9ca3af",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {STAGING_TYPE_LABELS[spot.type]}
                          {spot.status !== "Active" ? ` · ${spot.status}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <h4
                style={{
                  margin: "0 0 8px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: NAVY,
                }}
              >
                Add Staging Spot
              </h4>
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 12,
                  color: "#6b7280",
                  lineHeight: 1.45,
                }}
              >
                Choose a new code that does not appear in the list above.
              </p>
              <form onSubmit={handleAddStagingSpot}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <label style={labelStyle}>
                      Code <span style={{ color: RED }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={spotCode}
                      onChange={(e) => {
                        setSpotCode(e.target.value);
                        setSpotError(null);
                      }}
                      placeholder="e.g. s1a or G4"
                      required
                      list="existing-staging-spot-codes"
                      aria-describedby="staging-spot-code-hint"
                      style={{
                        ...inputStyle,
                        border: spotCodeConflict
                          ? `1.5px solid ${RED}`
                          : "1.5px solid #ccd0d7",
                      }}
                    />
                    <datalist id="existing-staging-spot-codes">
                      {existingSpotCodes.map((code) => (
                        <option key={code} value={code} />
                      ))}
                    </datalist>
                    {spotCodeConflict && conflictingSpot ? (
                      <p
                        id="staging-spot-code-hint"
                        style={{
                          margin: "6px 0 0",
                          fontSize: 12,
                          color: RED,
                          fontWeight: 600,
                        }}
                      >
                        {conflictingSpot.code} is already listed as &ldquo;
                        {conflictingSpot.label}&rdquo; — pick another code.
                      </p>
                    ) : spotCodeConflict ? (
                      <p
                        id="staging-spot-code-hint"
                        style={{
                          margin: "6px 0 0",
                          fontSize: 12,
                          color: RED,
                          fontWeight: 600,
                        }}
                      >
                        {spotCode.trim()} is already listed — pick another code.
                      </p>
                    ) : existingSpotCodes.length > 0 ? (
                      <p
                        id="staging-spot-code-hint"
                        style={{
                          margin: "6px 0 0",
                          fontSize: 11,
                          color: "#9ca3af",
                          lineHeight: 1.45,
                        }}
                      >
                        Listed codes:{" "}
                        <span style={{ fontFamily: "monospace", color: "#6b7280" }}>
                          {existingSpotCodes.join(", ")}
                        </span>
                      </p>
                    ) : (
                      <p
                        id="staging-spot-code-hint"
                        style={{
                          margin: "6px 0 0",
                          fontSize: 11,
                          color: "#9ca3af",
                        }}
                      >
                        Must differ from codes already listed above.
                      </p>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>
                      Label <span style={{ color: RED }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={spotLabel}
                      onChange={(e) => {
                        setSpotLabel(e.target.value);
                        setSpotError(null);
                      }}
                      placeholder="Ground Spot 4"
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select
                      value={spotType}
                      onChange={(e) =>
                        setSpotType(e.target.value as StagingSpotType)
                      }
                      style={inputStyle}
                    >
                      {STAGING_SPOT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {STAGING_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Sort order</label>
                    <input
                      type="number"
                      min={0}
                      value={spotSortOrder}
                      onChange={(e) => setSpotSortOrder(e.target.value)}
                      placeholder="Optional"
                      style={inputStyle}
                    />
                  </div>
                </div>
                {spotError && (
                  <p
                    style={{
                      margin: "0 0 12px",
                      fontSize: 13,
                      color: RED,
                      fontWeight: 600,
                    }}
                  >
                    {spotError}
                  </p>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    type="submit"
                    disabled={
                      savingSpot ||
                      !spotCode.trim() ||
                      !spotLabel.trim() ||
                      spotCodeConflict
                    }
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: "none",
                      backgroundColor:
                        savingSpot ||
                        !spotCode.trim() ||
                        !spotLabel.trim() ||
                        spotCodeConflict
                          ? "#f3f4f6"
                          : NAVY,
                      color:
                        savingSpot ||
                        !spotCode.trim() ||
                        !spotLabel.trim() ||
                        spotCodeConflict
                          ? "#9ca3af"
                          : "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor:
                        savingSpot ||
                        !spotCode.trim() ||
                        !spotLabel.trim() ||
                        spotCodeConflict
                          ? "not-allowed"
                          : "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    {savingSpot ? "Adding…" : "Add Spot"}
                  </button>
                  {spotSaved && (
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#2e7d32",
                      }}
                    >
                      Spot added ✓
                    </span>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
