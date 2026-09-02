import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export const STORAGE_KEY = "stageverify-operator-theme";

export type AdminAppearance = "light" | "dark";

const HTML_ATTR = "data-sv-admin-theme";

function isValidTheme(value: string | null): value is AdminAppearance {
  return value === "light" || value === "dark";
}

export function readStoredAdminAppearance(): AdminAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isValidTheme(raw) ? raw : "light";
  } catch {
    return "light";
  }
}

export function writeStoredAdminAppearance(theme: AdminAppearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage blocked */
  }
}

export function applyAdminAppearanceToDocument(theme: AdminAppearance): void {
  document.documentElement.setAttribute(HTML_ATTR, theme);
}

export function syncPortalShellAppearance(theme: AdminAppearance): void {
  for (const el of document.querySelectorAll(".portal-shell")) {
    el.setAttribute("data-admin-appearance", theme);
  }
}

type AdminAppearanceContextValue = {
  appearance: AdminAppearance;
  setAppearance: (theme: AdminAppearance) => void;
  toggleAppearance: () => void;
};

const AdminAppearanceContext =
  createContext<AdminAppearanceContextValue | null>(null);

export function AdminAppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<AdminAppearance>(() =>
    readStoredAdminAppearance(),
  );

  useEffect(() => {
    applyAdminAppearanceToDocument(appearance);
    syncPortalShellAppearance(appearance);
  }, [appearance]);

  const setAppearance = useCallback((theme: AdminAppearance) => {
    setAppearanceState(theme);
    writeStoredAdminAppearance(theme);
  }, []);

  const toggleAppearance = useCallback(() => {
    setAppearance(appearance === "light" ? "dark" : "light");
  }, [appearance, setAppearance]);

  const value = useMemo(
    () => ({ appearance, setAppearance, toggleAppearance }),
    [appearance, setAppearance, toggleAppearance],
  );

  return (
    <AdminAppearanceContext.Provider value={value}>
      {children}
    </AdminAppearanceContext.Provider>
  );
}

export function useAdminAppearance(): AdminAppearanceContextValue {
  const ctx = useContext(AdminAppearanceContext);
  if (!ctx) {
    throw new Error("useAdminAppearance must be used within AdminAppearanceProvider");
  }
  return ctx;
}

export function PortalShell({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { appearance } = useAdminAppearance();
  const mergedClass = ["portal-shell", className].filter(Boolean).join(" ");

  return (
    <div
      className={mergedClass}
      data-admin-appearance={appearance}
      style={style}
    >
      {children}
    </div>
  );
}
