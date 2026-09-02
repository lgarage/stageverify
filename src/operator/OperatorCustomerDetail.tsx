import { Link, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerBundle, OnboardingStatus } from "./customerModels";
import {
  getCustomerBundle,
  listAllowedOnboardingTransitions,
  rollupCustomerOnboarding,
  transitionLocationOnboarding,
} from "./operatorStore";
import { spotCountsFromLayout } from "./locationLayout";

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

function formatAddress(
  address: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  },
): string {
  const parts = [
    address.line1,
    address.line2,
    `${address.city}, ${address.region} ${address.postalCode}`,
    address.country,
  ].filter(Boolean);
  return parts.join(", ");
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
  const [target, setTarget] = useState<OnboardingStatus | "">(
    allowed[0] ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextAllowed = listAllowedOnboardingTransitions(current);
    setTarget(nextAllowed[0] ?? "");
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
        style={{
          padding: "6px 10px",
          fontSize: 13,
          color: TEXT,
          backgroundColor: "#fff",
          border: "1px solid var(--admin-border)",
          borderRadius: 6,
        }}
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
          try {
            transitionLocationOnboarding(locationId, target as OnboardingStatus);
            onApplied();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Transition failed");
          }
        }}
        style={{
          padding: "6px 12px",
          backgroundColor: NAVY,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Apply
      </button>
      {error ? (
        <span style={{ color: "#bf0a30", fontSize: 12 }}>{error}</span>
      ) : null}
    </div>
  );
}

export function OperatorCustomerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const [tab, setTab] = useState<TabId>("overview");
  const [bundle, setBundle] = useState<CustomerBundle | undefined>();
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    if (customerId) {
      setBundle(getCustomerBundle(customerId));
      setLoaded(true);
    }
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
    return (
      <p style={{ padding: 30, color: MUTED }}>Missing customer id.</p>
    );
  }

  if (!loaded) {
    return (
      <p style={{ padding: 30, color: MUTED }} data-testid="operator-customer-loading">
        Loading…
      </p>
    );
  }

  if (!bundle) {
    return (
      <div style={{ padding: 30 }}>
        <p style={{ color: MUTED }}>Customer not found.</p>
        <Link to="/customers" style={{ color: NAVY }}>
          Back to customers
        </Link>
      </div>
    );
  }

  const { customer, locations, users, events } = bundle;

  return (
    <div
      data-testid="operator-customer-detail"
      style={{
        padding: "30px",
        maxWidth: 1100,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div>
        <Link to="/customers" style={{ color: MUTED, fontSize: 13, textDecoration: "none" }}>
          ← Customers
        </Link>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: NAVY,
            margin: "8px 0 0",
          }}
        >
          {customer.companyName}
        </h1>
      </div>

      <div
        data-testid="operator-customer-tabs"
        role="tablist"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {TABS.map(({ id, label, testId }) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-testid={testId}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--admin-border)",
              backgroundColor: tab === id ? NAVY : "#fff",
              color: tab === id ? "#fff" : TEXT,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="admin-card"
        style={{
          backgroundColor: "#fff",
          padding: 20,
          borderRadius: 8,
          border: "1px solid var(--admin-border)",
          color: TEXT,
        }}
      >
        {tab === "overview" ? (
          <div style={{ display: "grid", gap: 12, fontSize: 14 }}>
            <p>
              <strong style={{ color: NAVY }}>Company:</strong> {customer.companyName}
            </p>
            <p>
              <strong style={{ color: NAVY }}>Contact:</strong>{" "}
              {customer.primaryContactName} — {customer.primaryContactEmail} —{" "}
              {customer.primaryContactPhone}
            </p>
            <p>
              <strong style={{ color: NAVY }}>Status:</strong> {customer.customerStatus}
            </p>
            <p>
              <strong style={{ color: NAVY }}>Locations:</strong> {locations.length}
            </p>
            <p>
              <strong style={{ color: NAVY }}>Onboarding rollup:</strong>{" "}
              {onboardingRollup}
            </p>
          </div>
        ) : null}

        {tab === "locations" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {locations.map((loc) => {
              const counts = spotCountsFromLayout(loc.layout);
              const labels = loc.layout.spots.map((s) => s.visibleLabel).join(", ");
              return (
                <div
                  key={loc.locationId}
                  style={{
                    borderBottom: "1px solid var(--admin-border)",
                    paddingBottom: 16,
                  }}
                >
                  <h3 style={{ margin: "0 0 8px", color: NAVY }}>{loc.locationName}</h3>
                  <p style={{ margin: "4px 0", fontSize: 13, color: MUTED }}>
                    ID: {loc.locationId}
                  </p>
                  <p style={{ margin: "4px 0" }}>
                    Physical: {formatAddress(loc.physicalAddress)}
                  </p>
                  <p style={{ margin: "4px 0" }}>
                    Billing: {formatAddress(loc.billingAddress)}
                    {loc.billingSameAsPhysical ? " (same as physical)" : ""}
                  </p>
                  <p style={{ margin: "4px 0" }}>
                    Spots: {counts.ground} ground, {counts.shelf} shelf — labels: {labels}
                  </p>
                  <p style={{ margin: "4px 0" }}>
                    Onboarding: <strong>{loc.onboardingStatus}</strong> · Location status:{" "}
                    {loc.locationStatus}
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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--admin-border)" }}>
                {["Name", "Email", "Role", "Locations"].map((col) => (
                  <th
                    key={col}
                    style={{ textAlign: "left", padding: "8px 0", color: NAVY }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12, color: MUTED }}>
                    No users
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.userId} style={{ borderBottom: "1px solid var(--admin-border)" }}>
                    <td style={{ padding: "8px 0" }}>{user.name}</td>
                    <td style={{ padding: "8px 0" }}>{user.email}</td>
                    <td style={{ padding: "8px 0" }}>{user.role}</td>
                    <td style={{ padding: "8px 0" }}>
                      {user.locationIds
                        .map((id) => locationNameById.get(id) ?? id)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}

        {tab === "billing" ? (
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Billing is a placeholder in this slice. Founding $199/location/month. Intended
            standard $399/location/month. Stripe IDs are nullable and unused. No payments.
          </p>
        ) : null}

        {tab === "activity" ? (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {events.length === 0 ? (
              <li style={{ color: MUTED }}>No activity yet</li>
            ) : (
              events.map((event) => (
                <li key={event.eventId} style={{ marginBottom: 8 }}>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                  {" — "}
                  {event.message}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
