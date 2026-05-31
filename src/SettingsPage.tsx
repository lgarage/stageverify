import { useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Vendor } from "./dispatcher/models";
import { vendors } from "./dispatcher/mockData";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

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
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [email, setEmail] = useState("");

  const handleAddVendor = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newVendor: Vendor = {
      id: "vendor-" + Date.now(),
      name: name.trim(),
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      email: email.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    vendors.push(newVendor);
    setRefresh((r) => r + 1);
    setName("");
    setContactName("");
    setContactPhone("");
    setEmail("");
  };

  const cardStyle = {
    backgroundColor: "#fff",
    border: "1px solid #dde1e7",
    borderRadius: 8,
    boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
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
              Manage vendors and system configuration.
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
                    {["Name", "Contact Name", "Contact Phone", "Email"].map(
                      (col) => (
                        <th
                          key={col}
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
                  {vendors.map((vendor, idx) => (
                    <tr
                      key={vendor.id}
                      style={{
                        backgroundColor: idx % 2 === 0 ? "#fff" : "#fafbfc",
                      }}
                    >
                      <td
                        style={{
                          padding: "14px 12px",
                          borderBottom: "1px solid #eaecf0",
                          fontWeight: 600,
                          color: "#111",
                        }}
                      >
                        {vendor.name}
                      </td>
                      <td
                        style={{
                          padding: "14px 12px",
                          borderBottom: "1px solid #eaecf0",
                          color: "#333",
                        }}
                      >
                        {vendor.contactName ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: "14px 12px",
                          borderBottom: "1px solid #eaecf0",
                          color: "#333",
                        }}
                      >
                        {vendor.contactPhone ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: "14px 12px",
                          borderBottom: "1px solid #eaecf0",
                          color: "#333",
                        }}
                      >
                        {vendor.email ?? "—"}
                      </td>
                    </tr>
                  ))}
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
                    onChange={(e) => setContactPhone(e.target.value)}
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
        </div>
      </div>
    </div>
  );
}
