/** Jake shop floor layout — hardcoded v1 geometry + optional persisted extras. */

/** Default ground spot chip size (px) — reserved slot matches until resized. */
export const SHOP_MAP_GROUND_SPOT_W = 52;
export const SHOP_MAP_GROUND_SPOT_H = 52;
/** Default shelf stagger chip size (px). */
export const SHOP_MAP_SHELF_SPOT_W = 40;
export const SHOP_MAP_SHELF_SPOT_H = 32;

export const SHOP_MAP_GROUND_CODES = [
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
] as const;

/** Left column bottom→top: G1–G4 */
export const SHOP_MAP_GROUND_LEFT = ["G1", "G2", "G3", "G4"] as const;

/** Top row left→right after G4 column: G5–G12 */
export const SHOP_MAP_GROUND_TOP = [
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
] as const;

/** Each shelf unit: 6 vertical levels (bottom→top), 2 cubbies per level — A/G … F/L (staggered on map). */
export const SHOP_MAP_SHELF_LEVELS = [
  ["A", "G"],
  ["B", "H"],
  ["C", "I"],
  ["D", "J"],
  ["E", "K"],
  ["F", "L"],
] as const;

export const SHOP_MAP_SHELF_UNITS = ["S1", "S2"] as const;

/** Default letters on every shelf unit (A–L). */
export const SHOP_MAP_DEFAULT_SHELF_LETTERS = SHOP_MAP_SHELF_LEVELS.flatMap(
  ([a, b]) => [a, b],
);

/** Persisted layout additions (appSettings.shopMapLayoutExtras). */
export type ShopMapLayoutExtras = {
  /** Extra ground slots beyond G1–G12 (e.g. G13). */
  extraGround?: string[];
  /** Extra shelf units beyond S1/S2 (e.g. S3). */
  extraShelfUnits?: string[];
  /** Extra spot letters beyond A–L, keyed by unit (e.g. { S1: ["M"] }). */
  extraShelfSpots?: Record<string, string[]>;
};

export type ResolvedShopMapLayout = {
  groundLeft: string[];
  groundTop: string[];
  groundCodes: string[];
  shelfUnits: string[];
  /** Letters per shelf unit (default A–L plus extras). */
  shelfLettersByUnit: Record<string, string[]>;
  extras: ShopMapLayoutExtras;
};

function canonGround(code: string): string | null {
  const m = /^G(\d+)$/i.exec(code.trim());
  return m ? `G${m[1]}` : null;
}

function canonShelfUnit(code: string): string | null {
  const m = /^S(\d+)$/i.exec(code.trim());
  return m ? `S${m[1]}` : null;
}

function canonShelfLetter(letter: string): string | null {
  const m = /^[A-Z]$/i.exec(letter.trim());
  return m ? m[0].toUpperCase() : null;
}

export function normalizeShopMapLayoutExtras(
  raw: ShopMapLayoutExtras | null | undefined,
): ShopMapLayoutExtras {
  const extraGround = [
    ...new Set(
      (raw?.extraGround ?? [])
        .map(canonGround)
        .filter((c): c is string => !!c)
        .filter((c) => !(SHOP_MAP_GROUND_CODES as readonly string[]).includes(c)),
    ),
  ].sort(
    (a, b) =>
      Number(/^G(\d+)$/i.exec(a)?.[1] ?? 0) -
      Number(/^G(\d+)$/i.exec(b)?.[1] ?? 0),
  );

  const extraShelfUnits = [
    ...new Set(
      (raw?.extraShelfUnits ?? [])
        .map(canonShelfUnit)
        .filter((c): c is string => !!c)
        .filter((c) => !(SHOP_MAP_SHELF_UNITS as readonly string[]).includes(c)),
    ),
  ].sort(
    (a, b) =>
      Number(/^S(\d+)$/i.exec(a)?.[1] ?? 0) -
      Number(/^S(\d+)$/i.exec(b)?.[1] ?? 0),
  );

  const extraShelfSpots: Record<string, string[]> = {};
  for (const [unitRaw, letters] of Object.entries(raw?.extraShelfSpots ?? {})) {
    const unit = canonShelfUnit(unitRaw);
    if (!unit) continue;
    const cleaned = [
      ...new Set(
        (letters ?? [])
          .map(canonShelfLetter)
          .filter((l): l is string => !!l)
          .filter(
            (l) =>
              !(SHOP_MAP_DEFAULT_SHELF_LETTERS as readonly string[]).includes(l),
          ),
      ),
    ].sort();
    if (cleaned.length) extraShelfSpots[unit] = cleaned;
  }

  return { extraGround, extraShelfUnits, extraShelfSpots };
}

/** Merge Jake constants with persisted extras for map rendering. */
export function resolveShopMapLayout(
  extras?: ShopMapLayoutExtras | null,
): ResolvedShopMapLayout {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const groundLeft = [...SHOP_MAP_GROUND_LEFT];
  const groundTop = [...SHOP_MAP_GROUND_TOP, ...(normalized.extraGround ?? [])];
  const groundCodes = [...SHOP_MAP_GROUND_CODES, ...(normalized.extraGround ?? [])];
  const shelfUnits = [
    ...SHOP_MAP_SHELF_UNITS,
    ...(normalized.extraShelfUnits ?? []),
  ];
  const shelfLettersByUnit: Record<string, string[]> = {};
  for (const unit of shelfUnits) {
    shelfLettersByUnit[unit] = [
      ...SHOP_MAP_DEFAULT_SHELF_LETTERS,
      ...(normalized.extraShelfSpots?.[unit] ?? []),
    ];
  }
  return {
    groundLeft,
    groundTop,
    groundCodes,
    shelfUnits,
    shelfLettersByUnit,
    extras: normalized,
  };
}

/** Next ground code (G13, G14, …) not already in layout. */
export function nextGroundSpotCode(layout: ResolvedShopMapLayout): string {
  let n = 1;
  const existing = new Set(layout.groundCodes.map((c) => c.toUpperCase()));
  while (existing.has(`G${n}`)) n += 1;
  return `G${n}`;
}

/** Next shelf unit (S3, S4, …) not already in layout. */
export function nextShelfUnitCode(layout: ResolvedShopMapLayout): string {
  let n = 1;
  const existing = new Set(layout.shelfUnits.map((c) => c.toUpperCase()));
  while (existing.has(`S${n}`)) n += 1;
  return `S${n}`;
}

/** Next free letter A–Z on a shelf unit (skips letters already present). */
export function nextShelfSpotLetter(
  layout: ResolvedShopMapLayout,
  unit: string,
): string | null {
  const unitKey = canonShelfUnit(unit);
  if (!unitKey) return null;
  const used = new Set(
    (layout.shelfLettersByUnit[unitKey] ?? SHOP_MAP_DEFAULT_SHELF_LETTERS).map(
      (l) => l.toUpperCase(),
    ),
  );
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return null;
}

export function shelfSpotCode(unit: string, letter: string): string {
  return `${unit.trim().toUpperCase()}${letter.trim().toUpperCase()}`;
}

export type ShopMapShelfUnit = string;

/** True for shelf unit keys S1/S2/S3 (not spot chips like S1A). */
export function isShelfUnitCode(code: string): boolean {
  return /^S\d+$/i.test(code.trim());
}

/** Parent shelf unit for a chip (S1A → S1), or null for ground. */
export function shelfUnitForSpot(code: string): string | null {
  const m = /^S(\d+)[A-Z]$/i.exec(code.replace(/-/g, ""));
  if (!m) return null;
  return `S${m[1]}`;
}

export function spotsForShelfUnit(
  unit: string,
  layout?: ResolvedShopMapLayout,
): string[] {
  const letters =
    layout?.shelfLettersByUnit[unit] ?? [...SHOP_MAP_DEFAULT_SHELF_LETTERS];
  return letters.map((letter) => shelfSpotCode(unit, letter));
}

export function allShopMapSpotCodes(layout?: ResolvedShopMapLayout): string[] {
  const resolved = layout ?? resolveShopMapLayout();
  const shelf = resolved.shelfUnits.flatMap((unit) =>
    spotsForShelfUnit(unit, resolved),
  );
  return [...resolved.groundCodes, ...shelf];
}

/** Infer zone type from Jake map spot code (G* ground, S* shelf). */
export function inferSpotZoneType(code: string): "ground" | "shelf" {
  return /^G\d+$/i.test(code.trim()) ? "ground" : "shelf";
}

export function defaultLabelForSpotCode(code: string): string {
  if (isShelfUnitCode(code)) {
    const n = /^S(\d+)$/i.exec(code.trim());
    return n ? `Shelf ${n[1]}` : code;
  }
  const shelf = /^S(\d+)([A-Z])$/i.exec(code.replace(/-/g, ""));
  if (shelf) return `Shelf ${shelf[1]} — ${shelf[2].toUpperCase()}`;
  const ground = /^G(\d+)$/i.exec(code.trim());
  if (ground) return `Ground Spot ${ground[1]}`;
  return code;
}

/** Append helpers — return new extras object (immutable). */
export function withExtraGroundSpot(
  extras: ShopMapLayoutExtras | null | undefined,
  code: string,
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const g = canonGround(code);
  if (!g) return normalized;
  if ((SHOP_MAP_GROUND_CODES as readonly string[]).includes(g)) return normalized;
  if (normalized.extraGround?.includes(g)) return normalized;
  return {
    ...normalized,
    extraGround: [...(normalized.extraGround ?? []), g],
  };
}

export function withExtraShelfUnit(
  extras: ShopMapLayoutExtras | null | undefined,
  unit: string,
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const u = canonShelfUnit(unit);
  if (!u) return normalized;
  if ((SHOP_MAP_SHELF_UNITS as readonly string[]).includes(u)) return normalized;
  if (normalized.extraShelfUnits?.includes(u)) return normalized;
  return {
    ...normalized,
    extraShelfUnits: [...(normalized.extraShelfUnits ?? []), u],
  };
}

export function withExtraShelfSpot(
  extras: ShopMapLayoutExtras | null | undefined,
  unit: string,
  letter: string,
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const u = canonShelfUnit(unit);
  const l = canonShelfLetter(letter);
  if (!u || !l) return normalized;
  if ((SHOP_MAP_DEFAULT_SHELF_LETTERS as readonly string[]).includes(l)) {
    return normalized;
  }
  const prev = normalized.extraShelfSpots?.[u] ?? [];
  if (prev.includes(l)) return normalized;
  return {
    ...normalized,
    extraShelfSpots: {
      ...normalized.extraShelfSpots,
      [u]: [...prev, l],
    },
  };
}
