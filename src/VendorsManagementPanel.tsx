import { useState, useEffect, useRef, type CSSProperties, type FormEvent } from "react";
import type { Vendor } from "./dispatcher/models";
import { listVendors, createVendor, updateVendor } from "./dispatcher/firestoreService";

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
  const [name, setName] = useState("");
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
    name: "",
    contactName: "",
    contactPhone: "",
    email: "",
    emailDomain: "",
    address: "",
    supplies: "",
    notes: "",
    active: true,
  });

  const startEdit = (vendor: Vendor) => {
    setEditingId(vendor.id);
    setEditDraft({
      name: vendor.name,
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
    if (!editDraft.name.trim()) return;
    const updated: Vendor = {
      ...withoutPlaintextVendorPin(vendor),
      name: editDraft.name.trim(),
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
    if (!name.trim()) return;
    const newVendor: Vendor = {
      id: "vendor-" + Date.now(),
      name: name.trim(),
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
    setName("");
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
                {vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                className="admin-table"
                style={{
                  minWidth: 600,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              >
                <thead>
                  <tr data-testid="vendors-table-header">
                    {["Name", "Active", "Contact Name", "Contact Phone", "Email", "Email Domain", "Address", "Supplies", "Notes", ""].map(
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
                  {vendors.map((vendor, idx) => {
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
                                disabled={!editDraft.name.trim()}
                                style={{
                                  padding: "3px 10px",
                                  borderRadius: 4,
                                  border: "none",
                                  backgroundColor: !editDraft.name.trim() ? "var(--admin-border)" : NAVY,
                                  color: !editDraft.name.trim()
                                    ? "var(--admin-text-muted)"
                                    : "var(--admin-on-navy)",
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

          {/* Add Vendor form */}
          <div className="admin-card" style={{ ...cardStyle, padding: "20px" }}>
            <h2
              style={{
                margin: "0 0 16px",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--admin-accent-soft)",
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
                      color: "var(--admin-text-muted)",
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
                disabled={!name.trim()}
                style={{
                  padding: "8px 18px",
                  borderRadius: "var(--admin-control-radius)",
                  border: "none",
                  backgroundColor: !name.trim() ? "var(--admin-surface-2)" : RED,
                  color: !name.trim() ? "var(--admin-text-muted)" : "var(--admin-on-navy)",
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
    </>
  );
}
