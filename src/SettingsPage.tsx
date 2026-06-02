import { useState, useEffect, useMemo, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Vendor, StagingLocation } from "./dispatcher/models";
import {
  getAppSettings,
  updateAppSettings,
  listVendors,
  createVendor,
  updateVendor,
  listAllZones,
  createZone,
} from "./dispatcher/firestoreService";

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
    to: "#",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    label: "Vendors",
    to: "#",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
];

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits.length ? `(${digits}` : "";
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const SETTINGS_ITEM = {
  label: "Settings",
  to: "/settings",
  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
};

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

export function SettingsPage() {
  const location = useLocation();
  const isSettings = location.pathname === "/settings";
  const isDashboard = location.pathname === "/dispatcher";

  const [, setRefresh] = useState(0);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [supplies, setSupplies] = useState("");
  const [notes, setNotes] = useState("");

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    contactName: string;
    contactPhone: string;
    email: string;
    address: string;
    supplies: string;
    notes: string;
  }>({ name: "", contactName: "", contactPhone: "", email: "", address: "", supplies: "", notes: "" });

  const startEdit = (vendor: Vendor) => {
    setEditingId(vendor.id);
    setEditDraft({
      name: vendor.name,
      contactName: vendor.contactName ?? "",
      contactPhone: vendor.contactPhone ?? "",
      email: vendor.email ?? "",
      address: vendor.address ?? "",
      supplies: vendor.supplies ?? "",
      notes: vendor.notes ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (vendor: Vendor) => {
    if (!editDraft.name.trim()) return;
    const updated: Vendor = {
      ...vendor,
      name: editDraft.name.trim(),
      contactName: editDraft.contactName.trim() || undefined,
      contactPhone: editDraft.contactPhone.trim() || undefined,
      email: editDraft.email.trim() || undefined,
      address: editDraft.address.trim() || undefined,
      supplies: editDraft.supplies.trim() || undefined,
      notes: editDraft.notes.trim() || undefined,
    };
    await updateVendor(updated);
    setVendors((prev) =>
      prev.map((v) => (v.id === vendor.id ? updated : v)),
    );
    setEditingId(null);
    setRefresh((r) => r + 1);
  };

  useEffect(() => {
    void listVendors().then(setVendors);
  }, []);

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

  const handleAddVendor = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newVendor: Vendor = {
      id: "vendor-" + Date.now(),
      name: name.trim(),
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      supplies: supplies.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    await createVendor(newVendor);
    setVendors((prev) => [...prev, newVendor]);
    setRefresh((r) => r + 1);
    setName("");
    setContactName("");
    setContactPhone("");
    setEmail("");
    setAddress("");
    setSupplies("");
    setNotes("");
  };

  const handleAddStagingSpot = async (e: FormEvent) => {
    e.preventDefault();
    const code = spotCode.trim();
    const label = spotLabel.trim();
    if (!code || !label || savingSpot) return;

    const codeKey = code.toUpperCase();
    if (
      stagingSpots.some((s) => s.code.trim().toUpperCase() === codeKey)
    ) {
      setSpotError(`Spot code "${code}" already exists.`);
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
        code,
        label,
        type: spotType,
        status: "Active",
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
        ...dims,
      });
      const newSpot: StagingLocation = {
        id,
        code,
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

  const existingCodeKeys = useMemo(
    () => new Set(existingSpotCodes.map((c) => c.toUpperCase())),
    [existingSpotCodes],
  );

  const spotCodeConflict =
    spotCode.trim().length > 0 &&
    existingCodeKeys.has(spotCode.trim().toUpperCase());

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

  return (
    <div style={{ fontFamily: FONT }} className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        style={{
          backgroundColor: NAVY,
          minHeight: "100vh",
          boxShadow: "rgba(0,0,0,0.15) 2px 0px 10px 0px",
        }}
        className="w-60 flex-shrink-0 hidden md:flex flex-col z-20"
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
              item.label === "Dispatcher Dashboard" ? isDashboard : false;
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
        className="flex-1 flex flex-col min-w-0 overflow-y-auto"
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
              Settings
            </span>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>
              / Vendor Management
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
              Manage vendors, staging spots, and workflow configuration.
            </p>
          </div>

          {/* Vendors section */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                Vendors
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: "#9ca3af",
                  fontWeight: 500,
                }}
              >
                {vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: 600,
                  borderCollapse: "collapse",
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: NAVY }}>
                    {["Name", "Contact Name", "Contact Phone", "Email", "Address", "Supplies", "Notes", ""].map(
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
                  {vendors.map((vendor, idx) => {
                    const isEditing = editingId === vendor.id;
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

                    return (
                      <tr key={vendor.id} style={{ backgroundColor: rowBg }}>
                        <td style={{ ...tdBase, fontWeight: 600, color: "#111" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, name: e.target.value }))
                              }
                              autoFocus
                            />
                          ) : (
                            vendor.name
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "#333" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.contactName}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, contactName: e.target.value }))
                              }
                            />
                          ) : (
                            vendor.contactName ?? "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "#333" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.contactPhone}
                              placeholder="(920) 555-1212"
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  contactPhone: formatPhone(e.target.value),
                                }))
                              }
                            />
                          ) : (
                            vendor.contactPhone ?? "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "#333" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.email}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, email: e.target.value }))
                              }
                            />
                          ) : (
                            vendor.email ?? "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "#333" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.address}
                              placeholder="123 Main St, City, ST 12345"
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, address: e.target.value }))
                              }
                            />
                          ) : (
                            vendor.address ?? "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "#333" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.supplies}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, supplies: e.target.value }))
                              }
                            />
                          ) : (
                            vendor.supplies ?? "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "#333" }}>
                          {isEditing ? (
                            <textarea
                              style={{ ...inlineInput, resize: "none" }}
                              rows={2}
                              value={editDraft.notes}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, notes: e.target.value }))
                              }
                            />
                          ) : vendor.notes ? (
                            vendor.notes.length > 60
                              ? `${vendor.notes.slice(0, 60)}…`
                              : vendor.notes
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => saveEdit(vendor)}
                                disabled={!editDraft.name.trim()}
                                style={{
                                  padding: "3px 10px",
                                  borderRadius: 4,
                                  border: "none",
                                  backgroundColor: !editDraft.name.trim() ? "#e5e7eb" : NAVY,
                                  color: !editDraft.name.trim() ? "#9ca3af" : "#fff",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: !editDraft.name.trim() ? "not-allowed" : "pointer",
                                  fontFamily: FONT,
                                }}
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                style={{
                                  padding: "3px 10px",
                                  borderRadius: 4,
                                  border: "1.5px solid #ccd0d7",
                                  backgroundColor: "#fff",
                                  color: "#6b7280",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: FONT,
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(vendor)}
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
          </div>

          {/* Add Vendor form */}
          <div style={{ ...cardStyle, padding: "20px" }}>
            <h2
              style={{
                margin: "0 0 16px",
                fontSize: 15,
                fontWeight: 700,
                color: NAVY,
              }}
            >
              Add Vendor
            </h2>
            <form onSubmit={handleAddVendor}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Name <span style={{ color: RED }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    style={{
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
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    style={{
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
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    value={contactPhone}
                    placeholder="(920) 555-1212"
                    onChange={(e) => setContactPhone(formatPhone(e.target.value))}
                    style={{
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
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
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
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 6 }}>
                    Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, City, ST 12345"
                    style={{
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
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Supplies
                  </label>
                  <input
                    type="text"
                    value={supplies}
                    onChange={(e) => setSupplies(e.target.value)}
                    placeholder="e.g. HVAC parts, copper pipe"
                    style={{
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
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes for this vendor"
                    rows={3}
                    style={{
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
                      resize: "none",
                    }}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!name.trim()}
                style={{
                  padding: "8px 18px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: !name.trim() ? "#f3f4f6" : RED,
                  color: !name.trim() ? "#9ca3af" : "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: !name.trim() ? "not-allowed" : "pointer",
                  fontFamily: FONT,
                  outline: "none",
                }}
              >
                Add Vendor
              </button>
            </form>
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
                Vendor Revert Window
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

            <div
              style={{
                borderTop: "1px solid #eaecf0",
                padding: "20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      color: NAVY,
                    }}
                  >
                    Staging Spots
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
                  </h3>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 12,
                      color: "#6b7280",
                      lineHeight: 1.45,
                      maxWidth: 560,
                    }}
                  >
                    Spots already in the system appear below. Add new ones with
                    a code that is not already listed. A top-down shop map will
                    come later — for now spots appear in vendor check-in and
                    dispatcher assignment.
                  </p>
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
                      <tr style={{ backgroundColor: "#f8fafc" }}>
                        {["Code", "Label", "Type", "Status"].map((col) => (
                          <th
                            key={col}
                            style={{
                              padding: "10px 12px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: "#6b7280",
                              borderBottom: "1px solid #eaecf0",
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stagingSpots.map((spot, idx) => (
                        <tr
                          key={spot.id}
                          style={{
                            backgroundColor: idx % 2 === 0 ? "#fff" : "#fafbfc",
                          }}
                        >
                          <td
                            style={{
                              padding: "10px 12px",
                              fontWeight: 700,
                              fontFamily: "monospace",
                              color: NAVY,
                              borderBottom: "1px solid #eaecf0",
                            }}
                          >
                            {spot.code}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: "#333",
                              borderBottom: "1px solid #eaecf0",
                            }}
                          >
                            {spot.label}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: "#333",
                              borderBottom: "1px solid #eaecf0",
                            }}
                          >
                            {STAGING_TYPE_LABELS[spot.type]}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: spot.status === "Active" ? "#2e7d32" : "#6b7280",
                              fontWeight: 600,
                              borderBottom: "1px solid #eaecf0",
                            }}
                          >
                            {spot.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!loadingSpots && existingSpotCodes.length > 0 && (
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
                    Codes already in use
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 13,
                      color: "#374151",
                      lineHeight: 1.5,
                      fontFamily: "monospace",
                    }}
                  >
                    {existingSpotCodes.join(" · ")}
                  </p>
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
                      placeholder="e.g. G4"
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
                    {spotCodeConflict ? (
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
  );
}
