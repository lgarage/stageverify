import { useNavigate } from "react-router-dom";
import { useState, type CSSProperties, type FormEvent } from "react";
import type { AddressFields, OperatorUserRole } from "../domain/customerModels";
import { createCustomerWithOnboarding } from "../api/operatorApi";
import { OperatorDevBackendBlockedError } from "../api/assertSafeBackend";

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
    <div className="admin-card operator-form-section">
      <h3 style={{ color: NAVY }}>Location {index + 1}</h3>
      <label style={labelStyle}>Location name</label>
      <input
        style={inputStyle}
        value={draft.locationName}
        onChange={(e) => onChange({ ...draft, locationName: e.target.value })}
      />
      <label style={labelStyle}>Physical line1</label>
      <input
        style={inputStyle}
        value={draft.physicalAddress.line1}
        onChange={(e) => updatePhysical("line1", e.target.value)}
      />
      <label style={labelStyle}>City / region / postal</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <input
          style={inputStyle}
          placeholder="City"
          value={draft.physicalAddress.city}
          onChange={(e) => updatePhysical("city", e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Region"
          value={draft.physicalAddress.region}
          onChange={(e) => updatePhysical("region", e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Postal"
          value={draft.physicalAddress.postalCode}
          onChange={(e) => updatePhysical("postalCode", e.target.value)}
        />
      </div>
      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={labelStyle}>Billing line1</label>
          <input
            style={inputStyle}
            data-testid={`operator-billing-line1-${index}`}
            value={draft.billingAddress.line1}
            onChange={(e) => updateBilling("line1", e.target.value)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <label style={labelStyle}>Billing city</label>
              <input
                style={inputStyle}
                data-testid={`operator-billing-city-${index}`}
                value={draft.billingAddress.city}
                onChange={(e) => updateBilling("city", e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Billing region</label>
              <input
                style={inputStyle}
                data-testid={`operator-billing-region-${index}`}
                value={draft.billingAddress.region}
                onChange={(e) => updateBilling("region", e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Billing postal</label>
              <input
                style={inputStyle}
                data-testid={`operator-billing-postal-${index}`}
                value={draft.billingAddress.postalCode}
                onChange={(e) => updateBilling("postalCode", e.target.value)}
              />
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        <div>
          <label style={labelStyle}>Billing contact</label>
          <input
            style={inputStyle}
            value={draft.billingContactName}
            onChange={(e) => onChange({ ...draft, billingContactName: e.target.value })}
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
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
          <label style={labelStyle}>Shelf spots</label>
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
  locations,
  onChange,
}: {
  index: number;
  draft: UserDraft;
  locations: LocationDraft[];
  onChange: (next: UserDraft) => void;
}) {
  return (
    <div className="admin-card operator-form-section" data-testid={`operator-user-draft-${index}`}>
      <h3 style={{ color: NAVY }}>User {index + 1}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
            type="email"
            value={draft.email}
            onChange={(e) => onChange({ ...draft, email: e.target.value })}
          />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={labelStyle}>Role</label>
        <select
          style={inputStyle}
          value={draft.role}
          onChange={(e) => onChange({ ...draft, role: e.target.value as OperatorUserRole })}
        >
          <option value="customer_admin">Customer admin</option>
          <option value="manager">Manager</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="technician">Technician</option>
        </select>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
        <legend style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
          Assigned locations
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          {locations.map((loc, locIdx) => {
            const label = loc.locationName.trim() || `Location ${locIdx + 1}`;
            return (
              <label
                key={locIdx}
                style={{ display: "flex", alignItems: "center", gap: 6, color: TEXT }}
              >
                <input
                  type="checkbox"
                  data-testid={`operator-user-${index}-loc-${locIdx}`}
                  checked={draft.locationIndexes.includes(locIdx)}
                  onChange={(e) => {
                    const locationIndexes = e.target.checked
                      ? [...draft.locationIndexes, locIdx]
                      : draft.locationIndexes.filter((i) => i !== locIdx);
                    onChange({ ...draft, locationIndexes });
                  }}
                />
                {label}
              </label>
            );
          })}
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

function newUserDraft(locationCount: number): UserDraft {
  return {
    name: "",
    email: "",
    role: "dispatcher",
    locationIndexes: locationCount > 0 ? [0] : [],
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
    void createCustomerWithOnboarding({
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
    })
      .then((bundle) => {
        navigate(`/customers/${bundle.customer.customerId}`);
      })
      .catch((err: unknown) => {
        if (err instanceof OperatorDevBackendBlockedError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "Failed to create customer");
        }
        setSubmitting(false);
      });
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="operator-customer-onboarding-form"
      className="operator-page operator-form"
    >
      <div>
        <h1 style={{ color: NAVY }}>New Customer</h1>
        <p style={{ color: MUTED, fontSize: 13 }}>
          Onboard a customer with locations and users (cloud store).
        </p>
      </div>

      <section className="admin-card operator-form-section">
        <h2 style={{ color: NAVY }}>Customer</h2>
        <label style={labelStyle}>Company *</label>
        <input style={inputStyle} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <label style={labelStyle}>Main contact</label>
        <input style={inputStyle} value={primaryContactName} onChange={(e) => setPrimaryContactName(e.target.value)} />
        <label style={labelStyle}>Email</label>
        <input style={inputStyle} type="email" value={primaryContactEmail} onChange={(e) => setPrimaryContactEmail(e.target.value)} />
        <label style={labelStyle}>Phone</label>
        <input style={inputStyle} value={primaryContactPhone} onChange={(e) => setPrimaryContactPhone(e.target.value)} />
      </section>

      <section>
        <div className="operator-page-header">
          <h2 style={{ color: NAVY }}>Locations</h2>
          <button type="button" onClick={() => setLocations((prev) => [...prev, newLocationDraft()])}>
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

      <section>
        <div className="operator-page-header">
          <h2 style={{ color: NAVY }}>Users</h2>
          <button
            type="button"
            data-testid="operator-add-user"
            onClick={() => setUsers((prev) => [...prev, newUserDraft(locations.length)])}
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
              locations={locations}
              onChange={(next) =>
                setUsers((prev) => prev.map((item, i) => (i === index ? next : item)))
              }
            />
          ))
        )}
      </section>

      {error ? (
        <p style={{ color: "#bf0a30" }} role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        data-testid="operator-customer-create-submit"
        className="operator-primary-link"
      >
        Create customer
      </button>
    </form>
  );
}
