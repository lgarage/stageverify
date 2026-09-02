import { useNavigate } from "react-router-dom";
import { useState, type CSSProperties, type FormEvent } from "react";
import type { AddressFields, OperatorUserRole } from "./customerModels";
import { createCustomerWithOnboarding } from "./operatorStore";

const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "#fff",
  border: "1px solid var(--admin-border)",
  borderRadius: 6,
  boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: MUTED,
  marginBottom: 4,
};

function emptyAddress(): AddressFields {
  return {
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "US",
  };
}

type LocationDraft = {
  locationName: string;
  physicalAddress: AddressFields;
  billingAddress: AddressFields;
  billingSameAsPhysical: boolean;
  billingContactName: string;
  billingEmail: string;
  billingPhone: string;
  groundSpotCount: number;
  shelfSpotCount: number;
};

type UserDraft = {
  name: string;
  email: string;
  role: OperatorUserRole;
  locationIndexes: number[];
};

function LocationFields({
  index,
  draft,
  onChange,
}: {
  index: number;
  draft: LocationDraft;
  onChange: (next: LocationDraft) => void;
}) {
  const updatePhysical = (field: keyof AddressFields, value: string) => {
    const physicalAddress = { ...draft.physicalAddress, [field]: value };
    const next: LocationDraft = { ...draft, physicalAddress };
    if (draft.billingSameAsPhysical) {
      next.billingAddress = { ...physicalAddress };
    }
    onChange(next);
  };

  const updateBilling = (field: keyof AddressFields, value: string) => {
    onChange({
      ...draft,
      billingAddress: { ...draft.billingAddress, [field]: value },
    });
  };

  return (
    <div
      style={{
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        padding: 16,
        backgroundColor: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h3 style={{ margin: 0, color: NAVY, fontSize: 16 }}>Location {index + 1}</h3>
      <div>
        <label style={labelStyle}>Location name</label>
        <input
          style={inputStyle}
          value={draft.locationName}
          onChange={(e) => onChange({ ...draft, locationName: e.target.value })}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {(["line1", "line2", "city", "region", "postalCode", "country"] as const).map(
          (field) => (
            <div key={field}>
              <label style={labelStyle}>Physical {field}</label>
              <input
                style={inputStyle}
                value={draft.physicalAddress[field] ?? ""}
                onChange={(e) => updatePhysical(field, e.target.value)}
              />
            </div>
          ),
        )}
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: TEXT,
          fontSize: 14,
        }}
      >
        <input
          type="checkbox"
          data-testid={`operator-billing-same-${index}`}
          checked={draft.billingSameAsPhysical}
          onChange={(e) => {
            const billingSameAsPhysical = e.target.checked;
            onChange({
              ...draft,
              billingSameAsPhysical,
              billingAddress: billingSameAsPhysical
                ? { ...draft.physicalAddress }
                : draft.billingAddress,
            });
          }}
        />
        Billing same as physical
      </label>
      {!draft.billingSameAsPhysical ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {(["line1", "line2", "city", "region", "postalCode", "country"] as const).map(
            (field) => (
              <div key={`billing-${field}`}>
                <label style={labelStyle}>Billing {field}</label>
                <input
                  style={inputStyle}
                  value={draft.billingAddress[field] ?? ""}
                  onChange={(e) => updateBilling(field, e.target.value)}
                />
              </div>
            ),
          )}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Billing contact</label>
          <input
            style={inputStyle}
            value={draft.billingContactName}
            onChange={(e) =>
              onChange({ ...draft, billingContactName: e.target.value })
            }
          />
        </div>
        <div>
          <label style={labelStyle}>Billing email</label>
          <input
            style={inputStyle}
            value={draft.billingEmail}
            onChange={(e) => onChange({ ...draft, billingEmail: e.target.value })}
          />
        </div>
        <div>
          <label style={labelStyle}>Billing phone</label>
          <input
            style={inputStyle}
            value={draft.billingPhone}
            onChange={(e) => onChange({ ...draft, billingPhone: e.target.value })}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Ground spots</label>
          <input
            type="number"
            min={0}
            style={inputStyle}
            value={draft.groundSpotCount}
            onChange={(e) =>
              onChange({
                ...draft,
                groundSpotCount: Number.parseInt(e.target.value, 10) || 0,
              })
            }
          />
        </div>
        <div>
          <label style={labelStyle}>Shelf staging positions</label>
          <input
            type="number"
            min={0}
            style={inputStyle}
            value={draft.shelfSpotCount}
            onChange={(e) =>
              onChange({
                ...draft,
                shelfSpotCount: Number.parseInt(e.target.value, 10) || 0,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

function UserFields({
  index,
  draft,
  locationCount,
  onChange,
}: {
  index: number;
  draft: UserDraft;
  locationCount: number;
  onChange: (next: UserDraft) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        padding: 16,
        backgroundColor: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h3 style={{ margin: 0, color: NAVY, fontSize: 16 }}>User {index + 1}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input
            style={inputStyle}
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            value={draft.email}
            onChange={(e) => onChange({ ...draft, email: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Role</label>
        <select
          style={inputStyle}
          value={draft.role}
          onChange={(e) =>
            onChange({ ...draft, role: e.target.value as OperatorUserRole })
          }
        >
          <option value="customer_admin">Customer admin</option>
          <option value="manager">Manager</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="technician">Technician</option>
        </select>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
          Assigned locations
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          {Array.from({ length: locationCount }, (_, locIdx) => (
            <label
              key={locIdx}
              style={{ display: "flex", alignItems: "center", gap: 6, color: TEXT }}
            >
              <input
                type="checkbox"
                checked={draft.locationIndexes.includes(locIdx)}
                onChange={(e) => {
                  const locationIndexes = e.target.checked
                    ? [...draft.locationIndexes, locIdx]
                    : draft.locationIndexes.filter((i) => i !== locIdx);
                  onChange({ ...draft, locationIndexes });
                }}
              />
              Location {locIdx + 1}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function newLocationDraft(): LocationDraft {
  return {
    locationName: "",
    physicalAddress: emptyAddress(),
    billingAddress: emptyAddress(),
    billingSameAsPhysical: true,
    billingContactName: "",
    billingEmail: "",
    billingPhone: "",
    groundSpotCount: 2,
    shelfSpotCount: 1,
  };
}

function newUserDraft(): UserDraft {
  return {
    name: "",
    email: "",
    role: "dispatcher",
    locationIndexes: [0],
  };
}

export function OperatorCustomerOnboardingForm() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [locations, setLocations] = useState<LocationDraft[]>([newLocationDraft()]);
  const [users, setUsers] = useState<UserDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const bundle = createCustomerWithOnboarding({
        companyName,
        primaryContactName,
        primaryContactEmail,
        primaryContactPhone,
        locations: locations.map((loc) => ({
          locationName: loc.locationName,
          physicalAddress: loc.physicalAddress,
          billingAddress: loc.billingAddress,
          billingSameAsPhysical: loc.billingSameAsPhysical,
          billingContactName: loc.billingContactName,
          billingEmail: loc.billingEmail,
          billingPhone: loc.billingPhone,
          groundSpotCount: loc.groundSpotCount,
          shelfSpotCount: loc.shelfSpotCount,
        })),
        users: users.map((user) => ({
          name: user.name,
          email: user.email,
          role: user.role,
          locationIndexes: user.locationIndexes,
        })),
      });
      navigate(`/customers/${bundle.customer.customerId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create customer");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="operator-customer-onboarding-form"
      style={{
        padding: "30px",
        maxWidth: 960,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, margin: 0 }}>
          New Customer
        </h1>
        <p style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
          Onboard a customer with locations and operator users (local store only).
        </p>
      </div>

      <section
        className="admin-card"
        style={{
          backgroundColor: "#fff",
          padding: 20,
          borderRadius: 8,
          border: "1px solid var(--admin-border)",
        }}
      >
        <h2 style={{ fontSize: 16, color: NAVY, marginTop: 0 }}>Customer</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Company *</label>
            <input
              style={inputStyle}
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Main contact</label>
            <input
              style={inputStyle}
              value={primaryContactName}
              onChange={(e) => setPrimaryContactName(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              type="email"
              value={primaryContactEmail}
              onChange={(e) => setPrimaryContactEmail(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input
              style={inputStyle}
              value={primaryContactPhone}
              onChange={(e) => setPrimaryContactPhone(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, color: NAVY, margin: 0 }}>Locations</h2>
          <button
            type="button"
            onClick={() => setLocations((prev) => [...prev, newLocationDraft()])}
            style={{
              padding: "8px 14px",
              backgroundColor: NAVY,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add Location
          </button>
        </div>
        {locations.map((loc, index) => (
          <LocationFields
            key={index}
            index={index}
            draft={loc}
            onChange={(next) =>
              setLocations((prev) => prev.map((item, i) => (i === index ? next : item)))
            }
          />
        ))}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, color: NAVY, margin: 0 }}>Users</h2>
          <button
            type="button"
            onClick={() => setUsers((prev) => [...prev, newUserDraft()])}
            style={{
              padding: "8px 14px",
              backgroundColor: NAVY,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add User
          </button>
        </div>
        {users.length === 0 ? (
          <p style={{ color: MUTED, fontSize: 13 }}>No users yet (optional).</p>
        ) : (
          users.map((user, index) => (
            <UserFields
              key={index}
              index={index}
              draft={user}
              locationCount={locations.length}
              onChange={(next) =>
                setUsers((prev) => prev.map((item, i) => (i === index ? next : item)))
              }
            />
          ))
        )}
      </section>

      {error ? (
        <p style={{ color: "#bf0a30", fontSize: 14 }} role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        data-testid="operator-customer-create-submit"
        style={{
          alignSelf: "flex-start",
          padding: "12px 24px",
          backgroundColor: "#bf0a30",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontWeight: 700,
          fontSize: 15,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        Create customer
      </button>
    </form>
  );
}
