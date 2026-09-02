import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { PortalSidebar } from "../PortalSidebar";
import { DispatcherPortalTopBar } from "../DispatcherPortalTopBar";
import { PortalShell } from "../PortalShell";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "../dispatcherPortalLayout";
import { listCustomersWithSummary } from "./operatorStore";
import { OperatorCustomerDetail } from "./OperatorCustomerDetail";
import { OperatorCustomerOnboardingForm } from "./OperatorCustomerOnboardingForm";
import { useCallback, useEffect, useState } from "react";
import type { CustomerSummary } from "./customerModels";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";

function CustomerListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CustomerSummary[]>([]);

  const refresh = useCallback(() => {
    setRows(listCustomersWithSummary());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div
      data-testid="operator-customers-page"
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
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
            Customers
          </h1>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
            Internal StageVerify operator console — not customer self-service.
          </p>
        </div>
        <Link
          to="/customers/new"
          data-testid="operator-customers-new"
          style={{
            backgroundColor: "#bf0a30",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          New Customer
        </Link>
      </div>

      <div
        className="admin-card"
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          border: "1px solid var(--admin-border)",
          overflow: "auto",
        }}
      >
        <table
          data-testid="operator-customer-list"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--admin-border)" }}>
              {["Company", "Locations", "Status", "Onboarding"].map((col) => (
                <th
                  key={col}
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    color: NAVY,
                    fontWeight: 700,
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 24, color: MUTED }}>
                  No customers yet. Create one to get started.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.customerId}
                  data-testid={`operator-customer-row-${row.customerId}`}
                  data-company={row.companyName}
                  onClick={() => navigate(`/customers/${row.customerId}`)}
                  style={{
                    borderBottom: "1px solid var(--admin-border)",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ padding: "12px 16px", color: TEXT }}>
                    <Link
                      to={`/customers/${row.customerId}`}
                      style={{ color: NAVY, fontWeight: 600, textDecoration: "none" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.companyName}
                    </Link>
                  </td>
                  <td style={{ padding: "12px 16px", color: TEXT }}>
                    {row.locationCount}
                  </td>
                  <td style={{ padding: "12px 16px", color: TEXT }}>
                    {row.customerStatus}
                  </td>
                  <td style={{ padding: "12px 16px", color: TEXT }}>
                    {row.onboardingRollup}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OperatorCustomersPage() {
  return (
    <PortalShell style={{ fontFamily: FONT }}>
      <PortalSidebar />

      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--admin-bg)" }}
      >
        <DispatcherPortalTopBar
          title="Customers"
          subtitle="Operator console"
          showNewDelivery={false}
        />

        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "var(--admin-bg)" }}
        >
          <Routes>
            <Route index element={<CustomerListPage />} />
            <Route path="new" element={<OperatorCustomerOnboardingForm />} />
            <Route path=":customerId" element={<OperatorCustomerDetail />} />
          </Routes>
        </div>
      </div>
    </PortalShell>
  );
}
