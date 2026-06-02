/** Shared dispatcher portal sidebar navigation (dispatcher / settings / zones). */

export type PortalNavItem = {
  label: string;
  to: string;
  icon: string;
};

export const PORTAL_NAV_ITEMS: PortalNavItem[] = [
  {
    label: "Dispatcher Dashboard",
    to: "/dispatcher",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    label: "Deliveries",
    to: "/dispatcher?focus=deliveries",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    label: "Staging Map",
    to: "/zones",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    label: "Vendors",
    to: "/settings?focus=vendors",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
];

export const PORTAL_SETTINGS_ITEM = {
  label: "Settings",
  to: "/settings",
  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
};

export function portalNavFocus(search: string): string | null {
  return new URLSearchParams(search).get("focus");
}

export function isPortalNavItemActive(
  item: PortalNavItem,
  pathname: string,
  search: string,
): boolean {
  const focus = portalNavFocus(search);
  switch (item.label) {
    case "Dispatcher Dashboard":
      return pathname === "/dispatcher" && focus !== "deliveries";
    case "Deliveries":
      return pathname === "/dispatcher" && focus === "deliveries";
    case "Staging Map":
      return pathname === "/zones";
    case "Vendors":
      return pathname === "/settings" && focus === "vendors";
    default:
      return false;
  }
}

/** Scroll the portal main pane to a focus section after navigation. */
export function scrollPortalFocus(
  focus: string | null,
  scrollRoot: HTMLElement | null,
): void {
  if (!focus || !scrollRoot) return;
  const targetId =
    focus === "deliveries"
      ? "portal-deliveries"
      : focus === "vendors"
        ? "portal-vendors"
        : null;
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!target) return;
  const rootTop = scrollRoot.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  scrollRoot.scrollTo({
    top: scrollRoot.scrollTop + (targetTop - rootTop) - 12,
    behavior: "smooth",
  });
}
