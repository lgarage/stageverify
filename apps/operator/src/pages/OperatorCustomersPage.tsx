import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { PortalShell } from "../adminAppearance";
import { PORTAL_MAIN_CLASS, PORTAL_SCROLL_CLASS } from "../portalLayout";
import { listCustomersWithSummary } from "../api/operatorApi";
import { OperatorCustomerDetail } from "./OperatorCustomerDetail";
import { OperatorCustomerOnboardingForm } from "./OperatorCustomerOnboardingForm";
import { OperatorSidebar } from "../components/OperatorSidebar";
import { OperatorTopBar } from "../components/OperatorTopBar";
import { useCallback, useEffect, useState } from "react";
import type { CustomerSummary } from "../domain/customerModels";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";

function CustomerListPage() {
  const navigate = useNavigate();
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

  return (
    <div data-testid="operator-customers-page" className="operator-page">
      <div className="operator-page-header">
        <div>
          <h1 style={{ color: NAVY }}>Customers</h1>
          <p style={{ color: MUTED, fontSize: 13 }}>
            Internal StageVerify operator console — not customer self-service.
          </p>
          {error ? <p style={{ color: "#bf0a30" }}>{error}</p> : null}
        </div>
        <Link to="/customers/new" data-testid="operator-customers-new" className="operator-primary-link">
          New Customer
        </Link>
      </div>

      <div className="admin-card operator-table-card">
        <table data-testid="operator-customer-list" className="operator-table">
          <thead>
            <tr>
              {["Company", "Locations", "Status", "Onboarding"].map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: MUTED }}>
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
                  className="operator-table-row-clickable"
                >
                  <td style={{ color: TEXT }}>
                    <Link to={`/customers/${row.customerId}`} onClick={(e) => e.stopPropagation()}>
                      {row.companyName}
                    </Link>
                  </td>
                  <td>{row.locationCount}</td>
                  <td>{row.customerStatus}</td>
                  <td>{row.onboardingRollup}</td>
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
      <OperatorSidebar />
      <div className={PORTAL_MAIN_CLASS} style={{ backgroundColor: "var(--admin-bg)" }}>
        <OperatorTopBar title="Customers" subtitle="Operator console" />
        <div className={PORTAL_SCROLL_CLASS} style={{ backgroundColor: "var(--admin-bg)" }}>
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
