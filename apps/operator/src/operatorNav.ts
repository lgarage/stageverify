/** Operator console sidebar navigation. */

export type OperatorNavItem = {
  label: string;
  to: string;
  icon: string;
};

export const OPERATOR_NAV_ITEMS: OperatorNavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    label: "Customers",
    to: "/customers",
    icon: "M3 21V7a2 2 0 012-2h4l2-2h4a2 2 0 012 2v16M9 21V9h6v12M3 21h18",
  },
  {
    label: "Onboarding",
    to: "/customers/new",
    icon: "M12 4v16m8-8H4",
  },
];

export function isOperatorNavItemActive(
  item: OperatorNavItem,
  pathname: string,
): boolean {
  switch (item.label) {
    case "Dashboard":
      return pathname === "/" || pathname === "";
    case "Customers":
      return (
        pathname.startsWith("/customers") && pathname !== "/customers/new"
      );
    case "Onboarding":
      return pathname === "/customers/new";
    default:
      return false;
  }
}
