import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "../PortalShell";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "../dispatcherPortalLayout";
import { listCustomersWithSummary } from "./operatorStore";
import type { CustomerSummary } from "./customerModels";
import { OperatorSidebar } from "./OperatorSidebar";
import { OperatorTopBar } from "./OperatorTopBar";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";

export function OperatorDashboardPage() {
  const [rows, setRows] = useState<CustomerSummary[]>([]);

  const refresh = useCallback(() => {
    setRows(listCustomersWithSummary());
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

      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--admin-bg)" }}
      >
        <OperatorTopBar title="Dashboard" subtitle="Operator console" />

        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "var(--admin-bg)" }}
        >
          <div
            data-testid="operator-dashboard-page"
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
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: NAVY,
                  margin: 0,
                }}
              >
                Operator Dashboard
              </h1>
              <p style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                Summary from local operator customer store (prototype).
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
              }}
            >
              {[
                {
                  testId: "operator-stat-customers",
                  label: "Customers",
                  value: stats.totalCustomers,
                },
                {
                  testId: "operator-stat-locations",
                  label: "Locations",
                  value: stats.totalLocations,
                },
                {
                  testId: "operator-stat-active",
                  label: "Active customers",
                  value: stats.activeCustomers,
                },
                {
                  testId: "operator-stat-onboarding-new",
                  label: "Onboarding NEW",
                  value: stats.onboardingNew,
                },
              ].map(({ testId, label, value }) => (
                <div
                  key={testId}
                  data-testid={testId}
                  className="admin-card"
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 8,
                    border: "1px solid var(--admin-border)",
                    padding: "16px 20px",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: TEXT,
                      marginTop: 8,
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
