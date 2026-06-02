import type { CSSProperties } from "react";

/** Full-viewport shell — only the main scroll region moves; sidebar + top bar stay fixed. */
export const PORTAL_SHELL_CLASS = "h-dvh max-h-dvh flex overflow-hidden";

export const PORTAL_SIDEBAR_CLASS =
  "w-60 flex-shrink-0 hidden md:flex flex-col h-full min-h-0 z-20";

export const PORTAL_SIDEBAR_STYLE: CSSProperties = {
  backgroundColor: "#0a3161",
  boxShadow: "rgba(0,0,0,0.15) 2px 0px 10px 0px",
};

export const PORTAL_MAIN_CLASS =
  "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden";

export const PORTAL_TOPBAR_CLASS =
  "shrink-0 z-10 flex items-center justify-between";

export const PORTAL_SCROLL_CLASS = "flex-1 min-h-0 overflow-y-auto";
