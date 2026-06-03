import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type CSSProperties,
  type FormEvent,
} from "react";
import { QRCodeSVG } from "qrcode.react";
import type { LocationStatus, StagingLocation } from "./dispatcher/models";
import { isLocationActive, LOCATION_STATUSES } from "./dispatcher/models";
import {
  formatStagingCodeCanonical,
  normalizeStagingCodeKey,
} from "./dispatcher/stagingCode";
import {
  listAllZones,
  createZone,
  updateZone,
  deactivateZone,
  mapActiveZoneOccupancyByCode,
  type ZoneOccupancySummary,
} from "./dispatcher/firestoreService";
import {
  buildZoneEslQrUrl,
  ESL_QR_RENDER_PROPS,
  formatZoneEslStatusLine,
} from "./receiveQrUrls";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_TOPBAR_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { PortalSidebar } from "./PortalSidebar";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const ZONE_TYPES = ["ground", "shelf", "bin", "other"] as const;
type ZoneType = (typeof ZONE_TYPES)[number];

const TYPE_LABELS: Record<ZoneType, string> = {
  ground: "Ground",
  shelf: "Shelf",
  bin: "Bin",
  other: "Other",
};

const ESL_TAG_HINT: Record<ZoneType, string> = {
  ground: "4.2\" Minew DS042Q — scan barcode on physical tag",
  shelf: "3.5\" Minew DS035Q — scan barcode on physical tag",
  bin: "Minew ESL tag barcode",
  other: "Minew ESL tag barcode",
};

function zoneOccupancy(
  code: string,
  byCode: Record<string, ZoneOccupancySummary>,
): ZoneOccupancySummary | undefined {
  return byCode[normalizeStagingCodeKey(code)];
}

function sortZones(a: StagingLocation, b: StagingLocation): number {
  const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

interface ZoneFormState {
  code: string;
  label: string;
  type: ZoneType;
  status: LocationStatus;
  notes: string;
  sortOrder: string;
  eslTagId: string;
  widthFt: string;
  depthFt: string;
}

function defaultDimensionsForType(type: ZoneType): {
  widthFt: string;
  depthFt: string;
} {
  if (type === "shelf" || type === "bin") {
    return { widthFt: "3", depthFt: "3" };
  }
  if (type === "ground") {
    return { widthFt: "4", depthFt: "4" };
  }
  return { widthFt: "", depthFt: "" };
}

const EMPTY_FORM: ZoneFormState = {
  code: "",
  label: "",
  type: "ground",
  status: "Planned",
  notes: "",
  sortOrder: "",
  eslTagId: "",
  ...defaultDimensionsForType("ground"),
};

function zoneToForm(zone: StagingLocation): ZoneFormState {
  return {
    code: zone.code,
    label: zone.label,
    type: zone.type,
    status: zone.status,
    notes: zone.notes ?? "",
    sortOrder: zone.sortOrder != null ? String(zone.sortOrder) : "",
    eslTagId: zone.eslTagId ?? "",
    widthFt: zone.widthFt != null ? String(zone.widthFt) : "",
    depthFt: zone.depthFt != null ? String(zone.depthFt) : "",
  };
}

function formToZoneData(form: ZoneFormState): Omit<StagingLocation, "id"> {
  const sortOrder = form.sortOrder.trim()
    ? Number(form.sortOrder)
    : undefined;
  const widthFt = form.widthFt.trim() ? Number(form.widthFt) : undefined;
  const depthFt = form.depthFt.trim() ? Number(form.depthFt) : undefined;
  return {
    code: formatStagingCodeCanonical(form.code),
    label: form.label.trim(),
    type: form.type,
    status: form.status,
    notes: form.notes.trim() || undefined,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
    eslTagId: form.eslTagId.trim() || undefined,
    widthFt: Number.isFinite(widthFt) ? widthFt : undefined,
    depthFt: Number.isFinite(depthFt) ? depthFt : undefined,
  };
}

const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  Planned: "Space is assigned",
  Installed: "Installed",
  Tagged: "Tagged",
  Active: "Active",
};

function statusBadgeStyle(status: LocationStatus): CSSProperties {
  const colors: Record<LocationStatus, { bg: string; text: string }> = {
    Planned: { bg: "#f3f4f6", text: "#6b7280" },
    Installed: { bg: "#e3f2fd", text: "#1565c0" },
    Tagged: { bg: "#fef3c7", text: "#b45309" },
    Active: { bg: "#e8f4ea", text: "#2e7d32" },
  };
  const c = colors[status];
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    backgroundColor: c.bg,
    color: c.text,
    marginLeft: 6,
  };
}

const cardStyle: CSSProperties = {
  backgroundColor: "#fff",
  border: "1px solid #dde1e7",
  borderRadius: 8,
  boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
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

function typeBadgeStyle(type: ZoneType): CSSProperties {
  const colors: Record<ZoneType, { bg: string; text: string }> = {
    ground: { bg: "#e8f4ea", text: "#2e7d32" },
    shelf: { bg: "#e3f2fd", text: "#1565c0" },
    bin: { bg: "#fff3e0", text: "#e65100" },
    other: { bg: "#f3f4f6", text: "#4b5563" },
  };
  const c = colors[type];
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    backgroundColor: c.bg,
    color: c.text,
  };
}

export function ZoneManagementPage() {
  const [zones, setZones] = useState<StagingLocation[]>([]);
  const [occupancyByZoneCode, setOccupancyByZoneCode] = useState<
    Record<string, ZoneOccupancySummary>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ZoneFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [eslDrafts, setEslDrafts] = useState<Record<string, string>>({});

  const loadZones = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loaded, occupancy] = await Promise.all([
        listAllZones(),
        mapActiveZoneOccupancyByCode(),
      ]);
      setZones(loaded);
      setOccupancyByZoneCode(occupancy);
      setEslDrafts(
        Object.fromEntries(
          loaded.map((z) => [z.id, z.eslTagId ?? ""]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  const visibleZones = useMemo(
    () => (showInactive ? zones : zones.filter(isLocationActive)),
    [zones, showInactive],
  );

  const groupedZones = useMemo(() => {
    const groups: Record<ZoneType, StagingLocation[]> = {
      ground: [],
      shelf: [],
      bin: [],
      other: [],
    };
    for (const zone of visibleZones) {
      groups[zone.type].push(zone);
    }
    for (const type of ZONE_TYPES) {
      groups[type].sort(sortZones);
    }
    return groups;
  }, [visibleZones]);

  const openAddForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (zone: StagingLocation) => {
    setEditingId(zone.id);
    setForm(zoneToForm(zone));
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.label.trim() || saving) return;

    setSaving(true);
    try {
      const data = formToZoneData(form);
      if (editingId) {
        await updateZone(editingId, data);
        setZones((prev) =>
          prev.map((z) => (z.id === editingId ? { ...z, ...data, id: editingId } : z)),
        );
        setEslDrafts((prev) => ({
          ...prev,
          [editingId]: data.eslTagId ?? "",
        }));
      } else {
        const id = await createZone(data);
        const newZone: StagingLocation = { ...data, id };
        setZones((prev) => [...prev, newZone]);
        setEslDrafts((prev) => ({ ...prev, [id]: data.eslTagId ?? "" }));
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save zone");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActivePlanned = async (zone: StagingLocation) => {
    const nextStatus: LocationStatus = isLocationActive(zone)
      ? "Planned"
      : "Active";
    try {
      if (nextStatus === "Planned") {
        await deactivateZone(zone.id);
      } else {
        await updateZone(zone.id, { status: "Active" });
      }
      setZones((prev) =>
        prev.map((z) =>
          z.id === zone.id ? { ...z, status: nextStatus } : z,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update zone status",
      );
    }
  };

  const saveEslTagId = async (zone: StagingLocation) => {
    const value = (eslDrafts[zone.id] ?? "").trim();
    if (value === (zone.eslTagId ?? "")) return;
    try {
      await updateZone(zone.id, { eslTagId: value || undefined });
      setZones((prev) =>
        prev.map((z) =>
          z.id === zone.id ? { ...z, eslTagId: value || undefined } : z,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ESL tag");
    }
  };

  const activeCount = zones.filter(isLocationActive).length;

  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>

      <PortalSidebar className="print:hidden" />

      {/* Main content */}
      <div
        className={`${PORTAL_MAIN_CLASS} print:hidden`}
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
              Zone Management
            </span>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>
              / Staging Map
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
          <div className="flex flex-wrap items-start justify-between gap-4">
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
                Zone Management
              </h1>
              <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                Link each staging spot to a Minew e-ink tag. QR and status text
                on the tag open receive for that zone or job (pushed via Minew
                API when connected).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openAddForm}
                style={{
                  padding: "8px 18px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: RED,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Add Zone
              </button>
            </div>
          </div>

          <div
            className="flex items-center gap-3"
            style={{ ...cardStyle, padding: "12px 16px" }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "#374151",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive zones
            </label>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              {activeCount} active · {zones.length} total
            </span>
          </div>

          {error && (
            <div
              style={{
                ...cardStyle,
                padding: "16px 20px",
                borderColor: "#fca5a5",
                backgroundColor: "#fef2f2",
                color: "#b91c1c",
                fontSize: 14,
              }}
            >
              {error}
              <button
                type="button"
                onClick={() => void loadZones()}
                style={{
                  marginLeft: 12,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid #b91c1c",
                  backgroundColor: "#fff",
                  color: "#b91c1c",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {showForm && (
            <div style={{ ...cardStyle, padding: "20px" }}>
              <h2
                style={{
                  margin: "0 0 16px",
                  fontSize: 15,
                  fontWeight: 700,
                  color: NAVY,
                }}
              >
                {editingId ? "Edit Zone" : "Add Zone"}
              </h2>
              <form onSubmit={(e) => void handleSubmit(e)}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label style={labelStyle}>
                      Code <span style={{ color: RED }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      value={form.code}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, code: e.target.value }))
                      }
                      required
                      placeholder="G1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>
                      Label <span style={{ color: RED }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      value={form.label}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, label: e.target.value }))
                      }
                      required
                      placeholder="Ground 1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select
                      style={inputStyle}
                      value={form.type}
                      onChange={(e) => {
                        const type = e.target.value as ZoneType;
                        const defaults = defaultDimensionsForType(type);
                        setForm((f) => ({
                          ...f,
                          type,
                          widthFt: defaults.widthFt,
                          depthFt: defaults.depthFt,
                        }));
                      }}
                    >
                      {ZONE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select
                      style={inputStyle}
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as LocationStatus,
                        }))
                      }
                    >
                      {LOCATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LOCATION_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Sort Order</label>
                    <input
                      style={inputStyle}
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, sortOrder: e.target.value }))
                      }
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Minew ESL Tag ID</label>
                    <input
                      style={inputStyle}
                      value={form.eslTagId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, eslTagId: e.target.value }))
                      }
                      placeholder="E0000001BC48"
                    />
                    <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                      {ESL_TAG_HINT[form.type]}
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Width (ft)</label>
                    <input
                      style={inputStyle}
                      type="number"
                      min={0}
                      step={0.5}
                      value={form.widthFt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, widthFt: e.target.value }))
                      }
                      placeholder="3"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Depth (ft)</label>
                    <input
                      style={inputStyle}
                      type="number"
                      min={0}
                      step={0.5}
                      value={form.depthFt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, depthFt: e.target.value }))
                      }
                      placeholder="3"
                    />
                    <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                      Used to suggest spot sizes during check-in
                    </p>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Notes</label>
                    <input
                      style={inputStyle}
                      value={form.notes}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      placeholder="Near dock entrance"
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="submit"
                    disabled={
                      saving || !form.code.trim() || !form.label.trim()
                    }
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: "none",
                      backgroundColor:
                        saving || !form.code.trim() || !form.label.trim()
                          ? "#f3f4f6"
                          : NAVY,
                      color:
                        saving || !form.code.trim() || !form.label.trim()
                          ? "#9ca3af"
                          : "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor:
                        saving || !form.code.trim() || !form.label.trim()
                          ? "not-allowed"
                          : "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    {saving ? "Saving…" : editingId ? "Save Changes" : "Create Zone"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelForm}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 4,
                      border: "1.5px solid #ccd0d7",
                      backgroundColor: "#fff",
                      color: "#6b7280",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading ? (
            <div
              style={{
                ...cardStyle,
                padding: "40px 20px",
                textAlign: "center",
                color: "#6b7280",
                fontSize: 14,
              }}
            >
              Loading zones…
            </div>
          ) : visibleZones.length === 0 ? (
            <div
              style={{
                ...cardStyle,
                padding: "40px 20px",
                textAlign: "center",
                color: "#6b7280",
                fontSize: 14,
              }}
            >
              No zones found. Add a zone to get started.
            </div>
          ) : (
            ZONE_TYPES.map((type) => {
              const typeZones = groupedZones[type];
              if (typeZones.length === 0) return null;
              return (
                <div key={type} style={{ ...cardStyle, overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "15px 20px",
                      borderBottom: "1px solid #eaecf0",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                      {TYPE_LABELS[type]}
                    </span>
                    <span style={typeBadgeStyle(type)}>{type}</span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "#9ca3af",
                        fontWeight: 500,
                      }}
                    >
                      {typeZones.length}{" "}
                      {typeZones.length === 1 ? "zone" : "zones"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(320px, 1fr))",
                      gap: 16,
                      padding: 20,
                    }}
                  >
                    {typeZones.map((zone) => {
                      const occupancy = zoneOccupancy(
                        zone.code,
                        occupancyByZoneCode,
                      );
                      const qrUrl = buildZoneEslQrUrl(zone.code, occupancy);
                      const eslStatus = formatZoneEslStatusLine(occupancy);
                      const tagLinked = Boolean(zone.eslTagId?.trim());
                      return (
                        <div
                          key={zone.id}
                          style={{
                            border: "1px solid #eaecf0",
                            borderRadius: 8,
                            padding: 16,
                            backgroundColor: isLocationActive(zone)
                              ? "#fff"
                              : "#fafafa",
                            opacity: isLocationActive(zone) ? 1 : 0.75,
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 28,
                                  fontWeight: 900,
                                  color: NAVY,
                                  lineHeight: 1,
                                  letterSpacing: "-0.02em",
                                }}
                              >
                                {zone.code}
                              </div>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: "#374151",
                                  marginTop: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  gap: 4,
                                }}
                              >
                                {zone.label}
                                <span style={statusBadgeStyle(zone.status)}>
                                  {LOCATION_STATUS_LABEL[zone.status]}
                                </span>
                              </div>
                              <div style={{ marginTop: 6 }}>
                                <span style={typeBadgeStyle(zone.type)}>
                                  {TYPE_LABELS[zone.type]}
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: "center", flexShrink: 0 }}>
                              <p
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color: "#6b7280",
                                  margin: "0 0 4px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                E-ink QR preview
                              </p>
                              <QRCodeSVG
                                value={qrUrl}
                                size={96}
                                {...ESL_QR_RENDER_PROPS}
                              />
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: 12,
                              padding: "10px 12px",
                              borderRadius: 6,
                              backgroundColor: occupancy ? "#e8f4ea" : "#f3f4f6",
                              border: `1px solid ${occupancy ? "#a5d6a7" : "#e5e7eb"}`,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: occupancy ? "#2e7d32" : "#6b7280",
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              {occupancy ? "Occupied on tag" : "Available on tag"}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#111827",
                                marginTop: 4,
                              }}
                            >
                              {eslStatus}
                            </div>
                          </div>

                          {zone.notes && (
                            <p
                              style={{
                                fontSize: 12,
                                color: "#6b7280",
                                marginTop: 10,
                                marginBottom: 0,
                              }}
                            >
                              {zone.notes}
                            </p>
                          )}

                          <div style={{ marginTop: 12 }}>
                            <label style={{ ...labelStyle, fontSize: 11 }}>
                              Minew ESL Tag ID
                            </label>
                            <input
                              style={{
                                ...inputStyle,
                                padding: "6px 10px",
                                fontSize: 13,
                              }}
                              value={eslDrafts[zone.id] ?? ""}
                              onChange={(e) =>
                                setEslDrafts((d) => ({
                                  ...d,
                                  [zone.id]: e.target.value,
                                }))
                              }
                              onBlur={() => void saveEslTagId(zone)}
                              placeholder="E0000001BC48"
                            />
                            <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
                              {ESL_TAG_HINT[zone.type]}
                              {!tagLinked && " · Required to push to Minew"}
                            </p>
                          </div>

                          <p
                            style={{
                              fontSize: 10,
                              color: "#9ca3af",
                              marginTop: 8,
                              wordBreak: "break-all",
                            }}
                          >
                            Tag QR: {qrUrl}
                          </p>

                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginTop: 12,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => openEditForm(zone)}
                              style={{
                                padding: "4px 12px",
                                borderRadius: 4,
                                border: `1.5px solid ${NAVY}`,
                                backgroundColor: "#fff",
                                color: NAVY,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: FONT,
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleActivePlanned(zone)}
                              style={{
                                padding: "4px 12px",
                                borderRadius: 4,
                                border: isLocationActive(zone)
                                  ? "1.5px solid #fca5a5"
                                  : `1.5px solid ${NAVY}`,
                                backgroundColor: "#fff",
                                color: isLocationActive(zone) ? "#b91c1c" : NAVY,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: FONT,
                              }}
                            >
                              {isLocationActive(zone)
                                ? "Space is assigned"
                                : "Set Active"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
