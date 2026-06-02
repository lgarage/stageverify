import { useState, useEffect, type CSSProperties, type FormEvent } from "react";
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

const cardStyle = {
  backgroundColor: "#fff",
  border: "1px solid #dde1e7",
  borderRadius: 8,
  boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
};

export function VendorsManagementPanel() {
  const [, setRefresh] = useState(0);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [supplies, setSupplies] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    contactName: "",
    contactPhone: "",
    email: "",
    address: "",
    supplies: "",
    notes: "",
  });

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

  const cancelEdit = () => setEditingId(null);

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
    setVendors((prev) => prev.map((v) => (v.id === vendor.id ? updated : v)));
    setEditingId(null);
    setRefresh((r) => r + 1);
  };

  useEffect(() => {
    void listVendors().then(setVendors);
  }, []);

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

  return (
    <>
          {/* Vendors section */}
          <div id="portal-vendors" style={{ ...cardStyle, overflow: "hidden" }}>
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
    </>
  );
}
