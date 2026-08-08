import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const STORAGE_KEY = "stageverify-theme";

export type AdminAppearance = "light" | "dark";

const HTML_ATTR = "data-sv-admin-theme";

function isValidTheme(value: string | null): value is AdminAppearance {
  return value === "light" || value === "dark";
}

/** Read persisted theme; missing or invalid values default to light. */
export function readStoredAdminAppearance(): AdminAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isValidTheme(raw) ? raw : "light";
  } catch {
    return "light";
  }
}

/** Persist theme immediately; storage errors are ignored. */
export function writeStoredAdminAppearance(theme: AdminAppearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage blocked */
  }
}

export function clearStoredAdminAppearance(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

export function applyAdminAppearanceToDocument(theme: AdminAppearance): void {
  document.documentElement.setAttribute(HTML_ATTR, theme);
}

/** Keep portal-shell data attrs aligned with the active theme. */
export function syncPortalShellAppearance(theme: AdminAppearance): void {
  for (const el of document.querySelectorAll(".portal-shell")) {
    el.setAttribute("data-admin-appearance", theme);
  }
}

type AdminAppearanceContextValue = {
  appearance: AdminAppearance;
  setAppearance: (theme: AdminAppearance) => void;
  toggleAppearance: () => void;
  forcedLight: boolean;
};

const AdminAppearanceContext = createContext<AdminAppearanceContextValue | null>(
  null,
);

type AdminAppearanceProviderProps = {
  children: ReactNode;
  /** Print routes always render light and skip persistence writes. */
  forceLight?: boolean;
};

export function AdminAppearanceProvider({
  children,
  forceLight = false,
}: AdminAppearanceProviderProps) {
  const [appearance, setAppearanceState] = useState<AdminAppearance>(() =>
    forceLight ? "light" : readStoredAdminAppearance(),
  );

  const effectiveAppearance: AdminAppearance = forceLight ? "light" : appearance;

  const setAppearance = useCallback(
    (theme: AdminAppearance) => {
      if (forceLight) return;
      writeStoredAdminAppearance(theme);
      setAppearanceState(theme);
      applyAdminAppearanceToDocument(theme);
      syncPortalShellAppearance(theme);
    },
    [forceLight],
  );

  const toggleAppearance = useCallback(() => {
    setAppearance(effectiveAppearance === "light" ? "dark" : "light");
  }, [effectiveAppearance, setAppearance]);

  useEffect(() => {
    const theme = forceLight ? "light" : readStoredAdminAppearance();
    applyAdminAppearanceToDocument(theme);
    syncPortalShellAppearance(theme);
    if (!forceLight) {
      setAppearanceState(theme);
    }
  }, [forceLight]);

  const value = useMemo(
    () => ({
      appearance: effectiveAppearance,
      setAppearance,
      toggleAppearance,
      forcedLight: forceLight,
    }),
    [effectiveAppearance, setAppearance, toggleAppearance, forceLight],
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
    throw new Error(
      "useAdminAppearance must be used within AdminAppearanceProvider",
    );
  }
  return ctx;
}
