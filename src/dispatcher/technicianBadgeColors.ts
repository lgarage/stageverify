import type { Technician } from "./models";

/** Preset badge triples — light fills + dark text, D-42 contrast validated. */
export const TECHNICIAN_BADGE_PALETTE = [
  { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" },
  { bg: "#ccfbf1", text: "#115e59", border: "#5eead4" },
  { bg: "#ffedd5", text: "#9a3412", border: "#fdba74" },
  { bg: "#f3e8ff", text: "#6b21a8", border: "#d8b4fe" },
  { bg: "#ecfccb", text: "#365314", border: "#bef264" },
  { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" },
  { bg: "#e0f2fe", text: "#0c4a6e", border: "#7dd3fc" },
] as const;

export type TechnicianBadgeStyle = {
  bg: string;
  text: string;
  border: string;
};

/** Allowed stored badgeColor values (palette bg hex only). */
export const SWATCH_OPTIONS: readonly string[] = TECHNICIAN_BADGE_PALETTE.map(
  (p) => p.bg,
);

const paletteByBg = new Map<string, TechnicianBadgeStyle>(
  TECHNICIAN_BADGE_PALETTE.map((p) => [p.bg, p]),
);

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Stable default bg hex from technician id when none saved. */
export function defaultBadgeColorHex(techId: string): string {
  const idx = hashString(techId) % TECHNICIAN_BADGE_PALETTE.length;
  return TECHNICIAN_BADGE_PALETTE[idx].bg;
}

/** Resolve full badge style — allowlisted palette only; unknown hex falls back to id hash. */
export function resolveTechnicianBadgeStyle(
  tech: Pick<Technician, "id" | "badgeColor">,
): TechnicianBadgeStyle {
  const saved = tech.badgeColor?.trim().toLowerCase();
  if (saved) {
    const matched = paletteByBg.get(saved);
    if (matched) return matched;
  }
  const fallbackBg = defaultBadgeColorHex(tech.id);
  return paletteByBg.get(fallbackBg) ?? TECHNICIAN_BADGE_PALETTE[0];
}

export function isAllowedBadgeColor(hex: string): boolean {
  return paletteByBg.has(hex.trim().toLowerCase());
}
