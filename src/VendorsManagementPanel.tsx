import { useState, useEffect, useMemo, useRef, type CSSProperties, type FormEvent } from "react";
import type { Vendor } from "./dispatcher/models";
import { listVendors, createVendor, updateVendor } from "./dispatcher/firestoreService";
import {
  buildVendorDisplayFields,
  formatVendorDisplayName,
  listVendorCompanyNames,
  resolveVendorCompanyName,
  resolveVendorLocationName,
  vendorMatchesSearch,
} from "./dispatcher/vendorDisplayName";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits.length ? `(${digits}` : "";
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeEmailDomain(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function domainFromEmail(email: string): string | undefined {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain || undefined;
}

function withoutPlaintextVendorPin(vendor: Vendor): Vendor {
  const copy = { ...vendor };
  delete copy.pinCode;
  return copy;
}

const cardStyle = {
  backgroundColor: "var(--admin-surface)",
  border: "1px solid var(--admin-border)",
  borderRadius: "var(--admin-radius-lg)",
  boxShadow: "var(--admin-shadow-card)",
};

export function VendorsManagementPanel({
  syncedVendors,
  refreshGeneration = 0,
}: {
  syncedVendors?: Vendor[] | null;
  refreshGeneration?: number;
}) {
  const [, setRefresh] = useState(0);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const lastAppliedGeneration = useRef(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [address, setAddress] = useState("");
  const [supplies, setSupplies] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    companyName: "",
    locationName: "",
    contactName: "",
    contactPhone: "",
    email: "",
    emailDomain: "",
    address: "",
    supplies: "",
    notes: "",
    active: true,
  });

  const companyOptions = useMemo(() => listVendorCompanyNames(vendors), [vendors]);
  const filteredVendors = useMemo(
    () => vendors.filter((v) => vendorMatchesSearch(v, searchQuery)),
    [vendors, searchQuery],
  );

  const startEdit = (vendor: Vendor) => {
    setEditingId(vendor.id);
    setEditDraft({
      companyName: resolveVendorCompanyName(vendor),
      locationName: resolveVendorLocationName(vendor),
      contactName: vendor.contactName ?? "",
      contactPhone: vendor.contactPhone ?? "",
      email: vendor.email ?? "",
      emailDomain: vendor.emailDomain ?? "",
      address: vendor.address ?? "",
      supplies: vendor.supplies ?? "",
      notes: vendor.notes ?? "",
      active: vendor.active !== false,
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (vendor: Vendor) => {
    if (!editDraft.companyName.trim()) return;
    const display = buildVendorDisplayFields({
      companyName: editDraft.companyName,
      locationName: editDraft.locationName,
    });
    const updated: Vendor = {
      ...withoutPlaintextVendorPin(vendor),
      ...display,
      contactName: editDraft.contactName.trim() || undefined,
      contactPhone: editDraft.contactPhone.trim() || undefined,
      email: editDraft.email.trim() || undefined,
      emailDomain:
        normalizeEmailDomain(editDraft.emailDomain) ??
        domainFromEmail(editDraft.email),
      address: editDraft.address.trim() || undefined,
      supplies: editDraft.supplies.trim() || undefined,
      notes: editDraft.notes.trim() || undefined,
      active: editDraft.active,
      updatedAt: new Date().toISOString(),
    };
    await updateVendor(updated);
    setVendors((prev) => prev.map((v) => (v.id === vendor.id ? updated : v)));
    setEditingId(null);
    setRefresh((r) => r + 1);
  };

  useEffect(() => {
    if (syncedVendors && refreshGeneration > lastAppliedGeneration.current) {
      lastAppliedGeneration.current = refreshGeneration;
      setVendors(syncedVendors);
      return;
    }
    if (refreshGeneration === 0 && syncedVendors == null) {
      void listVendors().then(setVendors);
    }
  }, [syncedVendors, refreshGeneration]);

  const handleAddVendor = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;
    const display = buildVendorDisplayFields({
      companyName,
      locationName,
    });
    const newVendor: Vendor = {
      id: "vendor-" + Date.now(),
      ...display,
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      email: email.trim() || undefined,
      emailDomain: normalizeEmailDomain(emailDomain) ?? domainFromEmail(email),
      address: address.trim() || undefined,
      supplies: supplies.trim() || undefined,
      notes: notes.trim() || undefined,
      active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await createVendor(newVendor);
    setVendors((prev) => [...prev, newVendor]);
    setRefresh((r) => r + 1);
    setCompanyName("");
    setLocationName("");
    setContactName("");
    setContactPhone("");
    setEmail("");
    setEmailDomain("");
    setAddress("");
    setSupplies("");
    setNotes("");
    setActive(true);
  };

  return (
    <>
          {/* Vendors section */}
          <div id="portal-vendors" className="admin-table-wrap" style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid var(--admin-border)",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--admin-accent-soft)" }}>
                Vendors
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: "var(--admin-text-muted)",
                  fontWeight: 500,
                }}
              >
                {filteredVendors.length} of {vendors.length}{" "}
                {vendors.length === 1 ? "location" : "locations"}
              </span>
            </div>

            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--admin-border)" }}>
              <label
                htmlFor="vendors-search"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--admin-text-muted)",
                  marginBottom: 6,
                  fontFamily: FONT,
                }}
              >
                Search companies or locations
              </label>
              <input
                id="vendors-search"
                data-testid="vendors-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Johnstone, Appleton, De Pere…"
                style={{
                  width: "100%",
                  maxWidth: 420,
                  padding: "10px 12px",
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: "var(--admin-control-radius)",
                  fontSize: 14,
                  color: "var(--admin-text)",
                  outline: "none",
                  backgroundColor: "var(--admin-surface)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
              <table
                className="admin-table vendors-admin-table"
                style={{
                  minWidth: 600,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              >
                <thead>
                  <tr data-testid="vendors-table-header">
                    {["Display Name", "Company", "Location", "Active", "Contact Name", "Contact Phone", "Email", "Email Domain", "Address", "Supplies", "Notes", ""].map(
                      (col, i) => (
                        <th
                          key={i}
                          style={{
                            fontWeight: 700,
                            fontSize: 12,
                            color: "var(--admin-text-muted)",
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
                  {filteredVendors.map((vendor, idx) => {
                    const isEditing = editingId === vendor.id;
                    const rowBg = idx % 2 === 0 ? "var(--admin-row-even)" : "var(--admin-row-odd)";
                    const tdBase: CSSProperties = {
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--admin-border)",
                      verticalAlign: "middle",
                    };
                    const inlineInput: CSSProperties = {
                      padding: "4px 8px",
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: "var(--admin-control-radius)",
                      fontSize: 13,
                      color: "var(--admin-text)",
                      fontFamily: FONT,
                      outline: "none",
                      width: "100%",
                      boxSizing: "border-box",
                      backgroundColor: "var(--admin-surface)",
                    };

                    return (
                      <tr
                        key={vendor.id}
                        style={{ backgroundColor: rowBg }}
                        {...(idx === 0 ? { "data-testid": "vendors-table-row" } : {})}
                      >
                        <td style={{ ...tdBase, fontWeight: 600, color: "var(--admin-text)" }}>
                          {isEditing
                            ? formatVendorDisplayName({
                                companyName: editDraft.companyName,
                                locationName: editDraft.locationName,
                              }) || "—"
                            : formatVendorDisplayName(vendor)}
                        </td>
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
                          {isEditing ? (
                            <>
                              <input
                                list="vendor-company-options"
                                style={inlineInput}
                                value={editDraft.companyName}
                                data-testid="edit-vendor-company"
                                onChange={(e) =>
                                  setEditDraft((d) => ({
                                    ...d,
                                    companyName: e.target.value,
                                  }))
                                }
                                autoFocus
                              />
                            </>
                          ) : (
                            resolveVendorCompanyName(vendor) || "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.locationName}
                              data-testid="edit-vendor-location"
                              placeholder="Appleton"
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  locationName: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            resolveVendorLocationName(vendor) || "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
                          {isEditing ? (
                            <input
                              type="checkbox"
                              checked={editDraft.active}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, active: e.target.checked }))
                              }
                            />
                          ) : vendor.active === false ? (
                            "Inactive"
                          ) : (
                            "Active"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
                          {isEditing ? (
                            <input
                              style={inlineInput}
                              value={editDraft.emailDomain}
                              placeholder="johnstone.com"
                              data-testid="edit-vendor-email-domain"
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  emailDomain: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            vendor.emailDomain ?? domainFromEmail(vendor.email ?? "") ?? "—"
                          )}
                        </td>
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                        <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                                data-testid="vendor-row-save"
                                onClick={() => saveEdit(vendor)}
                                disabled={!editDraft.companyName.trim()}
                                style={{
                                  padding: "3px 10px",
                                  borderRadius: 4,
                                  border: "none",
                                  backgroundColor: !editDraft.companyName.trim() ? "var(--admin-border)" : NAVY,
                                  color: !editDraft.companyName.trim()
                                    ? "var(--admin-text-muted)"
                                    : "var(--admin-on-navy)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: !editDraft.companyName.trim() ? "not-allowed" : "pointer",
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
                                  border: "1.5px solid var(--admin-border)",
                                  backgroundColor: "var(--admin-surface)",
                                  color: "var(--admin-text-muted)",
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
                              data-testid="vendor-row-edit"
                              onClick={() => startEdit(vendor)}
                              style={{
                                padding: "3px 10px",
                                borderRadius: 4,
                                border: "1.5px solid var(--admin-accent-soft)",
                                backgroundColor: "var(--admin-surface)",
                                color: "var(--admin-accent-soft)",
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

          {/* Add Vendor Location form */}
          <div className="admin-card" style={{ ...cardStyle, padding: "20px" }}>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--admin-accent-soft)",
              }}
            >
              Add Vendor Location
            </h2>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 12,
                color: "var(--admin-text-secondary)",
                fontFamily: FONT,
              }}
            >
              Pick or type a company, then add a branch/location. Display name is
              generated as Company — Location.
            </p>
            <datalist id="vendor-company-options">
              {companyOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
                      color: "var(--admin-text-muted)",
                      marginBottom: 6,
                    }}
                  >
                    Company <span style={{ color: RED }}>*</span>
                  </label>
                  <input
                    type="text"
                    list="vendor-company-options"
                    data-testid="add-vendor-company"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    placeholder="Johnstone Supply"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
                      marginBottom: 6,
                    }}
                  >
                    Location / Branch
                  </label>
                  <input
                    type="text"
                    data-testid="add-vendor-location"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="Appleton"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
                      fontFamily: FONT,
                      boxSizing: "border-box",
                    }}
                  />
                  {companyName.trim() ? (
                    <p
                      data-testid="add-vendor-display-preview"
                      style={{
                        margin: "6px 0 0",
                        fontSize: 12,
                        color: "var(--admin-text-secondary)",
                        fontFamily: FONT,
                      }}
                    >
                      Display:{" "}
                      {formatVendorDisplayName({
                        companyName,
                        locationName,
                      })}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--admin-text-muted)",
                      marginBottom: 6,
                    }}
                  >
                    Active
                  </label>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    style={{ width: 18, height: 18 }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--admin-text-muted)",
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
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
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
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
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
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
                      marginBottom: 6,
                    }}
                  >
                    Email Domain
                  </label>
                  <input
                    type="text"
                    value={emailDomain}
                    onChange={(e) => setEmailDomain(e.target.value)}
                    placeholder="johnstone.com"
                    data-testid="add-vendor-email-domain"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
                      fontFamily: FONT,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--admin-text-muted)", marginBottom: 6 }}>
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
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
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
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
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
                      color: "var(--admin-text-muted)",
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
                      border: "1.5px solid var(--admin-border)",
                      borderRadius: 6,
                      fontSize: 14,
                      color: "var(--admin-text)",
                      outline: "none",
                      backgroundColor: "var(--admin-surface)",
                      fontFamily: FONT,
                      boxSizing: "border-box",
                      resize: "none",
                    }}
                  />
                </div>
              </div>
              <button
                type="submit"
                data-testid="add-vendor-submit"
                disabled={!companyName.trim()}
                style={{
                  padding: "8px 18px",
                  borderRadius: "var(--admin-control-radius)",
                  border: "none",
                  backgroundColor: !companyName.trim() ? "var(--admin-surface-2)" : RED,
                  color: !companyName.trim() ? "var(--admin-text-muted)" : "var(--admin-on-navy)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: !companyName.trim() ? "not-allowed" : "pointer",
                  fontFamily: FONT,
                  outline: "none",
                }}
              >
                Add Vendor
              </button>
            </form>
          </div>
    </>
  );
}
