import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerBundle, OnboardingStatus } from "../domain/customerModels";
import {
  getCustomerBundle,
  listAllowedOnboardingTransitions,
  transitionLocationOnboarding,
} from "../api/operatorApi";
import { rollupCustomerOnboarding } from "../domain/onboardingTransitions";
import { spotCountsFromLayout } from "../domain/locationLayout";

const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";

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
          </div>
        ) : null}

        {tab === "users" ? (
          <table className="operator-table">
            <thead>
              <tr>
                {["Name", "Email", "Role", "Locations"].map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
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
              ))}
            </tbody>
          </table>
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
