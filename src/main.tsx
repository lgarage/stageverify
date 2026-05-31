import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App";
import { CheckInPage } from "./CheckInPage";
import { EntryDisplayPage } from "./EntryDisplayPage";
import { DispatcherDashboardPage } from "./DispatcherDashboardPage";
import { SettingsPage } from "./SettingsPage";
import { seedFirestore } from "./dispatcher/seedFirestore";

const root = createRoot(document.getElementById("root")!);

const renderApp = () => {
  root.render(
    <StrictMode>
      <HashRouter>
        <Routes>
          <Route path="/*" element={<App />} />
          <Route path="/checkin/:orderId" element={<CheckInPage />} />
          <Route path="/display" element={<EntryDisplayPage />} />
          <Route path="/dispatcher" element={<DispatcherDashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </HashRouter>
    </StrictMode>,
  );
};

// Render immediately so a Firestore error never produces a blank screen.
// Seed runs in the background; components handle their own loading states.
renderApp();
seedFirestore().catch((err) => {
  console.error("Firestore seed failed (app still works with empty DB):", err);
});
