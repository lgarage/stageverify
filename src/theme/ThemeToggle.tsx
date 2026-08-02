import { useLocation } from "react-router-dom";
import { useTheme } from "./ThemeProvider";

const PRINT_PATH_PREFIXES = ["/zones/print-label", "/zones/print-labels"];

/**
 * Floating theme pill — HVAC-style BR control. Hidden on print routes + print media.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();

  if (PRINT_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return null;
  }

  const goingLight = theme === "dark";
  const label = goingLight ? "Light" : "Dark";

  return (
    <button
      type="button"
      className="sv-theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${label.toLowerCase()} mode`}
      title={`Switch to ${label.toLowerCase()} mode`}
    >
      {goingLight ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
