import type { CSSProperties, ReactNode } from "react";
import { useAdminAppearance } from "./adminAppearance";

type PortalShellProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Print surfaces stay light regardless of user preference. */
  forceLight?: boolean;
};

export function PortalShell({
  children,
  className,
  style,
  forceLight = false,
}: PortalShellProps) {
  const { appearance } = useAdminAppearance();
  const effective = forceLight ? "light" : appearance;
  const mergedClass = ["portal-shell", className].filter(Boolean).join(" ");

  return (
    <div
      className={mergedClass}
      data-admin-appearance={effective}
      style={style}
    >
      {children}
    </div>
  );
}
