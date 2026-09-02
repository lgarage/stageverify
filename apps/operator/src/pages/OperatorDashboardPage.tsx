import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "../adminAppearance";
import { PORTAL_MAIN_CLASS, PORTAL_SCROLL_CLASS } from "../portalLayout";
import { listCustomersWithSummary } from "../api/operatorApi";
import type { CustomerSummary } from "../domain/customerModels";
import { OperatorSidebar } from "../components/OperatorSidebar";
import { OperatorTopBar } from "../components/OperatorTopBar";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";

export function OperatorDashboardPage() {
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listCustomersWithSummary()
      .then(setRows)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load customers");
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const totalCustomers = rows.length;
    const totalLocations = rows.reduce((sum, row) => sum + row.locationCount, 0);
    const onboardingNew = rows.filter((row) => row.onboardingRollup === "NEW").length;
    const activeCustomers = rows.filter((row) => row.customerStatus === "active").length;
    return { totalCustomers, totalLocations, onboardingNew, activeCustomers };
  }, [rows]);

  return (
    <PortalShell style={{ fontFamily: FONT }}>
      <OperatorSidebar />
      <div className={PORTAL_MAIN_CLASS} style={{ backgroundColor: "var(--admin-bg)" }}>
        <OperatorTopBar title="Dashboard" subtitle="Operator console" />
        <div className={PORTAL_SCROLL_CLASS} style={{ backgroundColor: "var(--admin-bg)" }}>
          <div data-testid="operator-dashboard-page" className="operator-page">
            <div>
              <h1 style={{ color: NAVY }}>Operator Dashboard</h1>
              <p style={{ color: MUTED, fontSize: 13 }}>
                Summary from cloud operator customer store.
              </p>
              {error ? <p style={{ color: "#bf0a30" }}>{error}</p> : null}
            </div>
            <div className="operator-stat-grid">
              {[
                { testId: "operator-stat-customers", label: "Customers", value: stats.totalCustomers },
                { testId: "operator-stat-locations", label: "Locations", value: stats.totalLocations },
                { testId: "operator-stat-active", label: "Active customers", value: stats.activeCustomers },
                { testId: "operator-stat-onboarding-new", label: "Onboarding NEW", value: stats.onboardingNew },
              ].map(({ testId, label, value }) => (
                <div key={testId} data-testid={testId} className="admin-card operator-stat-card">
                  <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: TEXT, marginTop: 8 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
