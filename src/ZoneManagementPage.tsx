import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import type { StagingLocation } from "./dispatcher/models";
import {
  listAllZones,
  createZone,
  updateZone,
  deactivateZone,
} from "./dispatcher/firestoreService";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const QR_BASE = "https://lgarage.github.io/stageverify/#/receive?zone=";

const ZONE_TYPES = ["ground", "shelf", "bin", "other"] as const;
type ZoneType = (typeof ZONE_TYPES)[number];

const TYPE_LABELS: Record<ZoneType, string> = {
  ground: "Ground",
  shelf: "Shelf",
  bin: "Bin",
  other: "Other",
};

const NAV_ITEMS = [
  {
    label: "Dispatcher Dashboard",
    to: "/dispatcher",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    label: "Deliveries",
    to: "#",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    label: "Staging Map",
    to: "/zones",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    label: "Vendors",
    to: "#",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
];

const SETTINGS_ITEM = {
  label: "Settings",
  to: "/settings",
  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
};

function zoneQrUrl(code: string): string {
  return `${QR_BASE}${encodeURIComponent(code)}`;
}

function navLinkStyle(active: boolean): CSSProperties {
  return active
    ? {
        backgroundColor: RED,
        color: "#fff",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "18px 20px",
        fontWeight: 700,
        fontSize: 15,
        textDecoration: "none",
        boxShadow: "0 2px 8px rgba(191,10,48,0.35)",
      }
    : {
        color: "rgba(255,255,255,0.60)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "18px 20px",
        fontWeight: 700,
        fontSize: 15,
        textDecoration: "none",
        transition: "background 0.15s, color 0.15s",
      };
}

function NavIcon({ icon }: { icon: string }) {
  return (
    <svg
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      style={{ flexShrink: 0 }}
    >
      {icon.split(" M").map((part, i) => (
        <path key={i} d={i === 0 ? part : "M" + part} />
      ))}
    </svg>
  );
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
  notes: string;
  sortOrder: string;
  eslTagId: string;
}

const EMPTY_FORM: ZoneFormState = {
  code: "",
  label: "",
  type: "ground",
  notes: "",
  sortOrder: "",
  eslTagId: "",
};

function zoneToForm(zone: StagingLocation): ZoneFormState {
  return {
    code: zone.code,
    label: zone.label,
    type: zone.type,
    notes: zone.notes ?? "",
    sortOrder: zone.sortOrder != null ? String(zone.sortOrder) : "",
    eslTagId: zone.eslTagId ?? "",
  };
}

function formToZoneData(form: ZoneFormState): Omit<StagingLocation, "id"> {
  const sortOrder = form.sortOrder.trim()
    ? Number(form.sortOrder)
    : undefined;
  return {
    code: form.code.trim(),
    label: form.label.trim(),
    type: form.type,
    active: true,
    notes: form.notes.trim() || undefined,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
    eslTagId: form.eslTagId.trim() || undefined,
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
  const location = useLocation();
  const isZones = location.pathname === "/zones";
  const isDashboard = location.pathname === "/dispatcher";
  const isSettings = location.pathname === "/settings";

  const [zones, setZones] = useState<StagingLocation[]>([]);
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
      const loaded = await listAllZones();
      setZones(loaded);
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
    () => (showInactive ? zones : zones.filter((z) => z.active)),
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

  const activeZonesForPrint = useMemo(
    () => zones.filter((z) => z.active).sort(sortZones),
    [zones],
  );

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

  const handleDeactivate = async (zone: StagingLocation) => {
    if (!zone.active) return;
    try {
      await deactivateZone(zone.id);
      setZones((prev) =>
        prev.map((z) => (z.id === zone.id ? { ...z, active: false } : z)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate zone");
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

  const activeCount = zones.filter((z) => z.active).length;

  return (
    <div style={{ fontFamily: FONT }} className="min-h-screen flex">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #zone-print-labels, #zone-print-labels * { visibility: visible !important; }
          #zone-print-labels {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0.5in;
          }
        }
      `}</style>

      {/* Sidebar */}
      <aside
        style={{
          backgroundColor: NAVY,
          minHeight: "100vh",
          boxShadow: "rgba(0,0,0,0.15) 2px 0px 10px 0px",
        }}
        className="w-60 flex-shrink-0 hidden md:flex flex-col z-20 print:hidden"
      >
        <div
          className="flex flex-col items-center px-6 pt-7 pb-5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
        >
          <div
            className="flex items-center justify-center rounded-full mb-3"
            style={{
              width: 60,
              height: 60,
              backgroundColor: "#fff",
              border: `3px solid ${RED}`,
              boxShadow: "0 2px 12px rgba(0,0,0,0.20)",
            }}
          >
            <span
              style={{
                color: NAVY,
                fontWeight: 900,
                fontSize: 20,
                letterSpacing: "-0.04em",
              }}
            >
              SV
            </span>
          </div>
          <span
            style={{
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "0.08em",
            }}
          >
            STAGEVERIFY
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.45)",
              fontSize: 11,
              marginTop: 2,
            }}
          >
            Dispatcher Portal
          </span>
        </div>

        <div className="px-5 pt-5 pb-1">
          <span
            style={{
              color: "rgba(255,255,255,0.35)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Main Menu
          </span>
        </div>

        <nav className="flex-1 px-3 pb-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active =
              item.label === "Dispatcher Dashboard"
                ? isDashboard
                : item.label === "Staging Map"
                  ? isZones
                  : false;
            const linkProps =
              item.to === "#"
                ? { to: "#", onClick: (e: MouseEvent) => e.preventDefault() }
                : { to: item.to };

            return (
              <Link
                key={item.label}
                {...linkProps}
                style={navLinkStyle(active)}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLElement).style.color = "#fff";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      "transparent";
                    (e.currentTarget as HTMLElement).style.color =
                      "rgba(255,255,255,0.60)";
                  }
                }}
              >
                <NavIcon icon={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div
          className="px-3 pb-2"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 8,
          }}
        >
          <Link
            to={SETTINGS_ITEM.to}
            style={navLinkStyle(isSettings)}
            onMouseEnter={(e) => {
              if (!isSettings) {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLElement).style.color = "#fff";
              }
            }}
            onMouseLeave={(e) => {
              if (!isSettings) {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "transparent";
                (e.currentTarget as HTMLElement).style.color =
                  "rgba(255,255,255,0.60)";
              }
            }}
          >
            <NavIcon icon={SETTINGS_ITEM.icon} />
            {SETTINGS_ITEM.label}
          </Link>
        </div>

        <div
          className="px-5 py-4 text-center"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.30)",
            fontSize: 11,
          }}
        >
          v1.0 &nbsp;·&nbsp; StageVerify
        </div>
      </aside>

      {/* Main content */}
      <div
        className="flex-1 flex flex-col min-w-0 overflow-y-auto print:hidden"
        style={{ backgroundColor: "#f0f2f5" }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between"
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
                Manage staging zones, ESL tags, and printable QR labels.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                disabled={activeCount === 0}
                style={{
                  padding: "8px 18px",
                  borderRadius: 4,
                  border: `1.5px solid ${NAVY}`,
                  backgroundColor: "#fff",
                  color: NAVY,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: activeCount === 0 ? "not-allowed" : "pointer",
                  fontFamily: FONT,
                  opacity: activeCount === 0 ? 0.5 : 1,
                }}
              >
                Print All Active Labels
              </button>
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
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          type: e.target.value as ZoneType,
                        }))
                      }
                    >
                      {ZONE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
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
                    <label style={labelStyle}>ESL Tag ID</label>
                    <input
                      style={inputStyle}
                      value={form.eslTagId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, eslTagId: e.target.value }))
                      }
                      placeholder="E0000001BC48"
                    />
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
                      const qrUrl = zoneQrUrl(zone.code);
                      return (
                        <div
                          key={zone.id}
                          style={{
                            border: "1px solid #eaecf0",
                            borderRadius: 8,
                            padding: 16,
                            backgroundColor: zone.active ? "#fff" : "#fafafa",
                            opacity: zone.active ? 1 : 0.75,
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
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
                                }}
                              >
                                {zone.label}
                              </div>
                              <div style={{ marginTop: 6 }}>
                                <span style={typeBadgeStyle(zone.type)}>
                                  {TYPE_LABELS[zone.type]}
                                </span>
                                {!zone.active && (
                                  <span
                                    style={{
                                      marginLeft: 6,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: "#9ca3af",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    Inactive
                                  </span>
                                )}
                              </div>
                            </div>
                            <QRCodeSVG value={qrUrl} size={80} />
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
                              ESL Tag ID
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
                          </div>

                          <p
                            style={{
                              fontSize: 10,
                              color: "#9ca3af",
                              marginTop: 8,
                              wordBreak: "break-all",
                            }}
                          >
                            {qrUrl}
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
                            {zone.active && (
                              <button
                                type="button"
                                onClick={() => void handleDeactivate(zone)}
                                style={{
                                  padding: "4px 12px",
                                  borderRadius: 4,
                                  border: "1.5px solid #fca5a5",
                                  backgroundColor: "#fff",
                                  color: "#b91c1c",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: FONT,
                                }}
                              >
                                Deactivate
                              </button>
                            )}
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

      {/* Print-only label grid */}
      <div
        id="zone-print-labels"
        className="hidden print:block"
        style={{ fontFamily: FONT }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 24,
          }}
        >
          {activeZonesForPrint.map((zone) => {
            const qrUrl = zoneQrUrl(zone.code);
            return (
              <div
                key={zone.id}
                style={{
                  border: "2px solid #333",
                  borderRadius: 8,
                  padding: 20,
                  textAlign: "center",
                  pageBreakInside: "avoid",
                }}
              >
                <div
                  style={{
                    fontSize: 36,
                    fontWeight: 900,
                    color: "#000",
                    lineHeight: 1,
                  }}
                >
                  {zone.code}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    marginTop: 6,
                    color: "#333",
                  }}
                >
                  {zone.label}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    marginTop: 4,
                    color: "#666",
                  }}
                >
                  {TYPE_LABELS[zone.type]}
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                  <QRCodeSVG value={qrUrl} size={128} />
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "#666",
                    marginTop: 10,
                    wordBreak: "break-all",
                  }}
                >
                  {qrUrl}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
