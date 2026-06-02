import type { CSSProperties } from "react";

/** Sticky viewport-height sidebar — Settings/footer stay visible while main content scrolls. */
export const PORTAL_SIDEBAR_STYLE: CSSProperties = {
  backgroundColor: "#0a3161",
  height: "100vh",
  maxHeight: "100vh",
  position: "sticky",
  top: 0,
  alignSelf: "flex-start",
  boxShadow: "rgba(0,0,0,0.15) 2px 0px 10px 0px",
};
