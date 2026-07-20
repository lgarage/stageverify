/** Default shop floor layout — hardcoded v1 geometry + optional persisted extras. */

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
  /**
   * Layout slots hidden from the map (any ground, shelf unit, or shelf chip).
   * Canonical codes e.g. G1, S2, S1A.
   */
  hiddenSlots?: string[];
  /**
   * Print/vendor "YOU ARE HERE" marker — offset + diameter (px) from entrance anchor.
   * Prefer this over legacy youAreHereOffset.
   */
  youAreHere?: { ox: number; oy: number; sizePx: number };
  /**
   * @deprecated Prefer youAreHere — kept for migrate-on-read.
   */
  youAreHereOffset?: { ox: number; oy: number };
  /**
   * Swinging-door icon offset (px) from the default entrance anchor.
   * Visible on dispatcher + print; drag in Edit mode.
   */
  doorOffset?: { ox: number; oy: number };
};

export const YOU_ARE_HERE_DEFAULT_SIZE_PX = 96;
export const YOU_ARE_HERE_MIN_SIZE_PX = 48;
export const YOU_ARE_HERE_MAX_SIZE_PX = 200;

export type YouAreHereMarker = {
  ox: number;
  oy: number;
  sizePx: number;
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

  const hiddenSlots = [
    ...new Set(
      (raw?.hiddenSlots ?? [])
        .map((c) => formatLayoutSlotKey(c))
        .filter((c): c is string => !!c),
    ),
  ].sort();

  const youAreHere = resolveYouAreHereMarker(raw);
  const rawDoor = raw?.doorOffset;
  const doorOffset =
    rawDoor &&
    Number.isFinite(rawDoor.ox) &&
    Number.isFinite(rawDoor.oy)
      ? { ox: Math.round(rawDoor.ox), oy: Math.round(rawDoor.oy) }
      : undefined;

  return {
    extraGround,
    extraShelfUnits,
    extraShelfSpots,
    hiddenSlots,
    ...(youAreHere ? { youAreHere } : {}),
    ...(doorOffset ? { doorOffset } : {}),
  };
}

function clampYouAreHereSize(sizePx: number): number {
  return Math.max(
    YOU_ARE_HERE_MIN_SIZE_PX,
    Math.min(YOU_ARE_HERE_MAX_SIZE_PX, Math.round(sizePx)),
  );
}

/** Resolve new or legacy YOU ARE HERE marker from extras. */
export function resolveYouAreHereMarker(
  raw: ShopMapLayoutExtras | null | undefined,
): YouAreHereMarker | undefined {
  const modern = raw?.youAreHere;
  if (
    modern &&
    Number.isFinite(modern.ox) &&
    Number.isFinite(modern.oy)
  ) {
    return {
      ox: Math.round(modern.ox),
      oy: Math.round(modern.oy),
      sizePx: Number.isFinite(modern.sizePx)
        ? clampYouAreHereSize(modern.sizePx)
        : YOU_ARE_HERE_DEFAULT_SIZE_PX,
    };
  }
  const legacy = raw?.youAreHereOffset;
  if (
    legacy &&
    Number.isFinite(legacy.ox) &&
    Number.isFinite(legacy.oy)
  ) {
    return {
      ox: Math.round(legacy.ox),
      oy: Math.round(legacy.oy),
      sizePx: YOU_ARE_HERE_DEFAULT_SIZE_PX,
    };
  }
  return undefined;
}

function roundOffset(offset: { ox: number; oy: number }): {
  ox: number;
  oy: number;
} {
  return { ox: Math.round(offset.ox), oy: Math.round(offset.oy) };
}

/** Persist / update the print/vendor "YOU ARE HERE" marker. */
export function withYouAreHere(
  extras: ShopMapLayoutExtras | null | undefined,
  marker: YouAreHereMarker,
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const { youAreHereOffset: _dropLegacy, ...rest } = normalized;
  return {
    ...rest,
    youAreHere: {
      ox: Math.round(marker.ox),
      oy: Math.round(marker.oy),
      sizePx: clampYouAreHereSize(marker.sizePx),
    },
  };
}

/** @deprecated Use withYouAreHere — keeps size from existing extras when only offset changes. */
export function withYouAreHereOffset(
  extras: ShopMapLayoutExtras | null | undefined,
  offset: { ox: number; oy: number },
): ShopMapLayoutExtras {
  const prev = resolveYouAreHereMarker(extras);
  return withYouAreHere(extras, {
    ox: offset.ox,
    oy: offset.oy,
    sizePx: prev?.sizePx ?? YOU_ARE_HERE_DEFAULT_SIZE_PX,
  });
}

/** Persist / update the swinging-door icon offset. */
export function withDoorOffset(
  extras: ShopMapLayoutExtras | null | undefined,
  offset: { ox: number; oy: number },
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  return {
    ...normalized,
    doorOffset: roundOffset(offset),
  };
}

function formatLayoutSlotKey(code: string): string | null {
  const t = code.trim().toUpperCase().replace(/-/g, "");
  if (/^G\d+$/.test(t)) return t;
  if (/^S\d+$/.test(t)) return t;
  if (/^S\d+[A-Z]$/.test(t)) return t;
  return null;
}

function isHidden(hidden: Set<string>, slot: string): boolean {
  const key = formatLayoutSlotKey(slot);
  return !!key && hidden.has(key);
}

/** Merge default layout constants with persisted extras for map rendering. */
export function resolveShopMapLayout(
  extras?: ShopMapLayoutExtras | null,
): ResolvedShopMapLayout {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const hidden = new Set(normalized.hiddenSlots ?? []);
  const groundLeft = [...SHOP_MAP_GROUND_LEFT].filter(
    (c) => !isHidden(hidden, c),
  );
  const groundTop = [
    ...SHOP_MAP_GROUND_TOP,
    ...(normalized.extraGround ?? []),
  ].filter((c) => !isHidden(hidden, c));
  const groundCodes = [
    ...SHOP_MAP_GROUND_CODES,
    ...(normalized.extraGround ?? []),
  ].filter((c) => !isHidden(hidden, c));
  const shelfUnits = [
    ...SHOP_MAP_SHELF_UNITS,
    ...(normalized.extraShelfUnits ?? []),
  ].filter((c) => !isHidden(hidden, c));
  const shelfLettersByUnit: Record<string, string[]> = {};
  for (const unit of shelfUnits) {
    shelfLettersByUnit[unit] = [
      ...SHOP_MAP_DEFAULT_SHELF_LETTERS,
      ...(normalized.extraShelfSpots?.[unit] ?? []),
    ].filter((letter) => !isHidden(hidden, shelfSpotCode(unit, letter)));
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

/** Infer zone type from map spot code (G* ground, S* shelf). */
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

/** Hide any layout slot (ground, shelf unit, or shelf chip) from the map. */
export function withHiddenSlots(
  extras: ShopMapLayoutExtras | null | undefined,
  slots: string[],
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const next = new Set(normalized.hiddenSlots ?? []);
  for (const slot of slots) {
    const key = formatLayoutSlotKey(slot);
    if (key) next.add(key);
  }
  return { ...normalized, hiddenSlots: [...next].sort() };
}

/** Un-hide slots (for undo). */
export function withoutHiddenSlots(
  extras: ShopMapLayoutExtras | null | undefined,
  slots: string[],
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const remove = new Set(
    slots
      .map(formatLayoutSlotKey)
      .filter((c): c is string => !!c),
  );
  return {
    ...normalized,
    hiddenSlots: (normalized.hiddenSlots ?? []).filter((c) => !remove.has(c)),
  };
}

/**
 * Slots to hide when deleting a ground spot, shelf chip, or whole shelf assembly.
 * Shelf unit → unit key + all chips on that unit.
 */
export function slotsToHideForDelete(
  layoutSlot: string,
  layout: ResolvedShopMapLayout,
): string[] {
  const key = formatLayoutSlotKey(layoutSlot);
  if (!key) return [];
  if (isShelfUnitCode(key)) {
    return [key, ...spotsForShelfUnit(key, layout)];
  }
  return [key];
}

/** Remove an extra ground code from extras (if present) and hide the slot. */
export function removeGroundSpotFromExtras(
  extras: ShopMapLayoutExtras | null | undefined,
  code: string,
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const g = canonGround(code);
  if (!g) return normalized;
  return withHiddenSlots(
    {
      ...normalized,
      extraGround: (normalized.extraGround ?? []).filter((c) => c !== g),
    },
    [g],
  );
}

/** Remove an extra shelf unit from extras (if present) and hide unit + chips. */
export function removeShelfUnitFromExtras(
  extras: ShopMapLayoutExtras | null | undefined,
  unit: string,
  layout: ResolvedShopMapLayout,
): ShopMapLayoutExtras {
  const normalized = normalizeShopMapLayoutExtras(extras);
  const u = canonShelfUnit(unit);
  if (!u) return normalized;
  const { [u]: _drop, ...restSpots } = normalized.extraShelfSpots ?? {};
  return withHiddenSlots(
    {
      ...normalized,
      extraShelfUnits: (normalized.extraShelfUnits ?? []).filter((c) => c !== u),
      extraShelfSpots: restSpots,
    },
    slotsToHideForDelete(u, layout),
  );
}
