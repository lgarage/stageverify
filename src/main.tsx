import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App";
import { CheckInPage } from "./CheckInPage";
import { EntryDisplayPage } from "./EntryDisplayPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/*" element={<App />} />
        <Route path="/checkin/:orderId" element={<CheckInPage />} />
        <Route path="/display" element={<EntryDisplayPage />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
);
