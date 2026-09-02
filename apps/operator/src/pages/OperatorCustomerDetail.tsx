import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AddressFields, CustomerBundle, OnboardingStatus, OperatorUserRole, PhysicalLocation } from "../domain/customerModels";
import {
  addLocationToCustomer,
  addUserToCustomer,
  getCustomerBundle,
  listAllowedOnboardingTransitions,
  transitionLocationOnboarding,
} from "../api/operatorApi";
import { rollupCustomerOnboarding } from "../domain/onboardingTransitions";
import { spotCountsFromLayout } from "../domain/locationLayout";

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

function AddLocationForm({
  customerId,
  onAdded,
}: {
  customerId: string;
  onAdded: () => void;
}) {
  const [draft, setDraft] = useState<LocationDraft>(newLocationDraft());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updatePhysical = (field: keyof AddressFields, value: string) => {
    const physicalAddress = { ...draft.physicalAddress, [field]: value };
    const next: LocationDraft = { ...draft, physicalAddress };
    if (draft.billingSameAsPhysical) {
      next.billingAddress = { ...physicalAddress };
    }
    setDraft(next);
  };

  const updateBilling = (field: keyof AddressFields, value: string) => {
    setDraft({
      ...draft,
      billingAddress: { ...draft.billingAddress, [field]: value },
    });
  };

  const handleSubmit = () => {
    setError(null);
    setSubmitting(true);
    void addLocationToCustomer({
      customerId,
      location: {
        locationName: draft.locationName,
        physicalAddress: draft.physicalAddress,
        billingAddress: draft.billingAddress,
        billingSameAsPhysical: draft.billingSameAsPhysical,
        billingContactName: draft.billingContactName,
        billingEmail: draft.billingEmail,
        billingPhone: draft.billingPhone,
        groundSpotCount: draft.groundSpotCount,
        shelfSpotCount: draft.shelfSpotCount,
      },
    })
      .then((_loc: PhysicalLocation) => {
        setDraft(newLocationDraft());
        onAdded();
        setSubmitting(false);
      })
      .catch((err: unknown) => {
        if (err instanceof OperatorDevBackendBlockedError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "Failed to add location");
        }
        setSubmitting(false);
      });
  };

  return (
    <div
      className="admin-card operator-form-section"
      data-testid="operator-add-location-form"
      style={{ marginTop: 16 }}
    >
      <h3 style={{ color: NAVY, marginTop: 0 }}>Add location</h3>
      <label style={labelStyle}>Location name</label>
      <input
        style={inputStyle}
        value={draft.locationName}
        onChange={(e) => setDraft({ ...draft, locationName: e.target.value })}
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
          checked={draft.billingSameAsPhysical}
          onChange={(e) => {
            const billingSameAsPhysical = e.target.checked;
            setDraft({
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
            value={draft.billingAddress.line1}
            onChange={(e) => updateBilling("line1", e.target.value)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <input
              style={inputStyle}
              placeholder="City"
              value={draft.billingAddress.city}
              onChange={(e) => updateBilling("city", e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Region"
              value={draft.billingAddress.region}
              onChange={(e) => updateBilling("region", e.target.value)}
            />
            <input
              style={inputStyle}
              placeholder="Postal"
              value={draft.billingAddress.postalCode}
              onChange={(e) => updateBilling("postalCode", e.target.value)}
            />
          </div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <div>
          <label style={labelStyle}>Ground spots</label>
          <input
            type="number"
            min={0}
            style={inputStyle}
            value={draft.groundSpotCount}
            onChange={(e) =>
              setDraft({
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
              setDraft({
                ...draft,
                shelfSpotCount: Number.parseInt(e.target.value, 10) || 0,
              })
            }
          />
        </div>
      </div>
      {error ? (
        <p style={{ color: "#bf0a30", fontSize: 13 }} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="operator-add-location-submit"
        disabled={submitting || !draft.locationName.trim()}
        onClick={handleSubmit}
        style={{
          marginTop: 12,
          padding: "8px 16px",
          backgroundColor: NAVY,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontWeight: 600,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        Add location
      </button>
    </div>
  );
}

function AddUserForm({
  customerId,
  locations,
  onAdded,
}: {
  customerId: string;
  locations: CustomerBundle["locations"];
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OperatorUserRole>("dispatcher");
  const [locationIds, setLocationIds] = useState<string[]>(() =>
    locations.length > 0 ? [locations[0].locationId] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleLocation = (locationId: string, checked: boolean) => {
    setLocationIds((prev) =>
      checked ? [...prev, locationId] : prev.filter((id) => id !== locationId),
    );
  };

  const handleSubmit = () => {
    setError(null);
    setSubmitting(true);
    void addUserToCustomer({
      customerId,
      user: { name, email, role, locationIds },
    })
      .then(() => {
        setName("");
        setEmail("");
        setRole("dispatcher");
        setLocationIds(locations.length > 0 ? [locations[0].locationId] : []);
        onAdded();
        setSubmitting(false);
      })
      .catch((err: unknown) => {
        if (err instanceof OperatorDevBackendBlockedError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "Failed to add user");
        }
        setSubmitting(false);
      });
  };

  return (
    <div
      className="admin-card operator-form-section"
      data-testid="operator-add-user-form"
      style={{ marginTop: 16 }}
    >
      <h3 style={{ color: NAVY, marginTop: 0 }}>Add user</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={labelStyle}>Role</label>
        <select
          style={inputStyle}
          value={role}
          onChange={(e) => setRole(e.target.value as OperatorUserRole)}
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
          {locations.map((loc) => (
            <label
              key={loc.locationId}
              style={{ display: "flex", alignItems: "center", gap: 6, color: TEXT }}
            >
              <input
                type="checkbox"
                data-testid={`operator-add-user-loc-${loc.locationId}`}
                checked={locationIds.includes(loc.locationId)}
                onChange={(e) => toggleLocation(loc.locationId, e.target.checked)}
              />
              {loc.locationName}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p style={{ color: "#bf0a30", fontSize: 13 }} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="operator-add-user-submit"
        disabled={submitting || !name.trim() || !email.trim() || locationIds.length === 0}
        onClick={handleSubmit}
        style={{
          marginTop: 12,
          padding: "8px 16px",
          backgroundColor: NAVY,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontWeight: 600,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        Add user
      </button>
    </div>
  );
}


type TabId = "overview" | "locations" | "users" | "billing" | "activity";

const TABS: { id: TabId; label: string; testId: string }[] = [
  { id: "overview", label: "Overview", testId: "operator-tab-overview" },
  { id: "locations", label: "Locations", testId: "operator-tab-locations" },
  { id: "users", label: "Users", testId: "operator-tab-users" },
  { id: "billing", label: "Billing", testId: "operator-tab-billing" },
  { id: "activity", label: "Activity", testId: "operator-tab-activity" },
];

function formatAddress(address: {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [
    address.line1,
    address.line2,
    `${address.city}, ${address.region} ${address.postalCode}`,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function LocationOnboardingControl({
  locationId,
  current,
  onApplied,
}: {
  locationId: string;
  current: OnboardingStatus;
  onApplied: () => void;
}) {
  const allowed = listAllowedOnboardingTransitions(current);
  const [target, setTarget] = useState<OnboardingStatus | "">(allowed[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTarget(listAllowedOnboardingTransitions(current)[0] ?? "");
  }, [current]);

  if (allowed.length === 0) {
    return <span style={{ color: MUTED, fontSize: 13 }}>Terminal — no transitions</span>;
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select
        data-testid={`operator-onboarding-to-${locationId}`}
        value={target}
        onChange={(e) => setTarget(e.target.value as OnboardingStatus)}
        style={{ padding: "6px 10px", color: TEXT, backgroundColor: "#fff" }}
      >
        {allowed.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid={`operator-onboarding-apply-${locationId}`}
        disabled={!target}
        onClick={() => {
          setError(null);
          void transitionLocationOnboarding({ locationId, to: target as OnboardingStatus })
            .then(() => onApplied())
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Transition failed");
            });
        }}
        style={{
          padding: "6px 12px",
          backgroundColor: NAVY,
          color: "#fff",
          border: "none",
          borderRadius: 6,
        }}
      >
        Apply
      </button>
      {error ? <span style={{ color: "#bf0a30", fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}

export function OperatorCustomerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const [tab, setTab] = useState<TabId>("overview");
  const [bundle, setBundle] = useState<CustomerBundle | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!customerId) return;
    void getCustomerBundle(customerId)
      .then((data) => {
        setBundle(data);
        setLoaded(true);
        setError(null);
      })
      .catch((err: unknown) => {
        setBundle(undefined);
        setLoaded(true);
        setError(err instanceof Error ? err.message : "Failed to load customer");
      });
  }, [customerId]);

  useEffect(() => {
    setLoaded(false);
    refresh();
  }, [refresh]);

  const onboardingRollup = useMemo(
    () => (bundle ? rollupCustomerOnboarding(bundle.locations) : "NEW"),
    [bundle],
  );

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    bundle?.locations.forEach((loc) => map.set(loc.locationId, loc.locationName));
    return map;
  }, [bundle]);

  if (!customerId) {
    return <p className="operator-page">Missing customer id.</p>;
  }

  if (!loaded) {
    return (
      <p className="operator-page" data-testid="operator-customer-loading">
        Loading…
      </p>
    );
  }

  if (!bundle) {
    return (
      <div className="operator-page">
        <p>{error ?? "Customer not found."}</p>
        <Link to="/customers">Back to customers</Link>
      </div>
    );
  }

  const { customer, locations, users, events } = bundle;

  return (
    <div data-testid="operator-customer-detail" className="operator-page">
      <Link to="/customers">← Customers</Link>
      <h1 style={{ color: NAVY }}>{customer.companyName}</h1>

      <div data-testid="operator-customer-tabs" role="tablist" className="operator-tabs">
        {TABS.map(({ id, label, testId }) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-testid={testId}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={tab === id ? "operator-tab active" : "operator-tab"}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="admin-card operator-detail-panel">
        {tab === "overview" ? (
          <div>
            <p><strong>Company:</strong> {customer.companyName}</p>
            <p><strong>Contact:</strong> {customer.primaryContactName} — {customer.primaryContactEmail}</p>
            <p><strong>Status:</strong> {customer.customerStatus}</p>
            <p><strong>Locations:</strong> {locations.length}</p>
            <p><strong>Onboarding rollup:</strong> {onboardingRollup}</p>
          </div>
        ) : null}

        {tab === "locations" ? (
          <div>
            {locations.map((loc) => {
              const counts = spotCountsFromLayout(loc.layout);
              return (
                <div key={loc.locationId} className="operator-location-block">
                  <h3 style={{ color: NAVY }}>{loc.locationName}</h3>
                  <p>Physical: {formatAddress(loc.physicalAddress)}</p>
                  <p>
                    Billing: {formatAddress(loc.billingAddress)}
                    {loc.billingSameAsPhysical ? " (same as physical)" : ""}
                  </p>
                  <p>
                    Spots: {counts.ground} ground, {counts.shelf} shelf — labels:{" "}
                    {loc.layout.spots.map((s) => s.visibleLabel).join(", ")}
                  </p>
                  <p>
                    Onboarding: <strong>{loc.onboardingStatus}</strong>
                  </p>
                  <LocationOnboardingControl
                    locationId={loc.locationId}
                    current={loc.onboardingStatus}
                    onApplied={refresh}
                  />
                </div>
              );
            })}
            <AddLocationForm customerId={customerId} onAdded={refresh} />
          </div>
        ) : null}

        {tab === "users" ? (
          <div>
            <table className="operator-table">
              <thead>
                <tr>
                  {["Name", "Email", "Role", "Locations"].map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: MUTED }}>
                      No users
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.userId}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{user.role}</td>
                      <td>
                        {user.locationIds
                          .map((id) => locationNameById.get(id) ?? id)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <AddUserForm customerId={customerId} locations={locations} onAdded={refresh} />
          </div>
        ) : null}

        {tab === "billing" ? (
          <p>
            Billing is a placeholder in this slice. Founding $199/location/month. Stripe IDs are
            nullable and unused.
          </p>
        ) : null}

        {tab === "activity" ? (
          <ul>
            {events.map((event) => (
              <li key={event.eventId}>
                {new Date(event.createdAt).toLocaleString()} — {event.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
