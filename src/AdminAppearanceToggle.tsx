import { useAdminAppearance } from "./adminAppearance";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function AdminAppearanceToggle() {
  const { appearance, toggleAppearance, forcedLight } = useAdminAppearance();

  if (forcedLight) return null;

  const isDark = appearance === "dark";
  const label = isDark ? "Light" : "Dark";

  return (
    <button
      type="button"
      className="admin-appearance-toggle"
      data-testid="admin-appearance-toggle"
      aria-label={`Switch to ${label.toLowerCase()} mode`}
      onClick={toggleAppearance}
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 40,
        fontFamily: FONT,
        fontSize: 13,
        fontWeight: 600,
        padding: "8px 16px",
        borderRadius: 9999,
        border: isDark ? "1px solid #557590" : "1px solid #d0d7de",
        backgroundColor: isDark ? "#20384f" : "#ffffff",
        color: isDark ? "#f0f6fc" : "#24292f",
        boxShadow: isDark
          ? "0 2px 10px rgba(1, 4, 9, 0.45)"
          : "0 2px 10px rgba(27, 31, 36, 0.12)",
        cursor: "pointer",
        minHeight: 36,
      }}
    >
      {label}
    </button>
  );
}

/** Mobile drawer control — not fixed over page content. */
export function AdminAppearanceDrawerButton() {
  const { appearance, toggleAppearance, forcedLight } = useAdminAppearance();
  if (forcedLight) return null;
  const isDark = appearance === "dark";
  const label = isDark ? "Light mode" : "Dark mode";
  return (
    <button
      type="button"
      className="portal-mobile-appearance"
      data-testid="portal-mobile-appearance"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={toggleAppearance}
    >
      {label}
    </button>
  );
}
