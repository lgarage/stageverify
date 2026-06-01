import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { seedFirestore } from "./dispatcher/seedFirestore";

const App = lazy(() => import("./App"));
const CheckInPage = lazy(() => import("./CheckInPage").then(m => ({ default: m.CheckInPage })));
const EntryDisplayPage = lazy(() => import("./EntryDisplayPage").then(m => ({ default: m.EntryDisplayPage })));
const DispatcherDashboardPage = lazy(() => import("./DispatcherDashboardPage").then(m => ({ default: m.DispatcherDashboardPage })));
const SettingsPage = lazy(() => import("./SettingsPage").then(m => ({ default: m.SettingsPage })));
const PickupPortalPage = lazy(() => import("./PickupPortalPage"));

const root = createRoot(document.getElementById("root")!);

const renderApp = () => {
  root.render(
    <StrictMode>
      <HashRouter>
        <Suspense fallback={<div style={{ color: "#888", padding: "2rem", textAlign: "center" }}>Loading…</div>}>
          <Routes>
            <Route path="/pickup" element={<PickupPortalPage />} />
            <Route path="/checkin/:orderId" element={<CheckInPage />} />
            <Route path="/display" element={<EntryDisplayPage />} />
            <Route path="/dispatcher" element={<DispatcherDashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/" element={<App />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </StrictMode>,
  );
};

renderApp();
seedFirestore().catch((err) => {
  console.error("Firestore seed failed (app still works with empty DB):", err);
});
