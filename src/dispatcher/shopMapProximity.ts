/**
 * Staging Map canvas-space proximity — SoT is ShopFloorMap geometry
 * (groundLeft / groundTop / shelf units + per-spot mapOffsetX/Y).
 * Not code-name order and not sortOrder.
 */
import {
  isLocationActive,
  isOversizedSpot,
  type StagingLocation,
  type UnplannedSpaceTier,
} from "./models";
import {
  SHOP_MAP_DEFAULT_SHELF_LETTERS,
  SHOP_MAP_GROUND_SPOT_H,
  SHOP_MAP_GROUND_SPOT_W,
  SHOP_MAP_SHELF_LEVELS,
  SHOP_MAP_SHELF_SPOT_H,
  SHOP_MAP_SHELF_SPOT_W,
  resolveShopMapCanvasSize,
  resolveShopMapLayout,
  shelfSpotCode,
  type ShopMapLayoutExtras,
} from "./shopMapLayout";
import { normalizeStagingCodeKey } from "./stagingCode";

export type MapPoint = { x: number; y: number };

/** Mirrors ShopFloorMap canvas / flex chrome (px). */
const CANVAS_PAD = 20;
const GRID_COL_GAP = 16;
const GROUND_GAP = 8;
const SHELF_BELOW_GAP = 16;
const SHELF_UNIT_GAP = 60;
const SHELF_ROW_MARGIN_LEFT = 60;
const SHELF_BAY = 52;
const SHELF_SPOT_COL_W = 84;
const SHELF_SPOT_COL_GAP = 6;
const SHELF_CHIP_A = { left: 0, top: 2 };
const SHELF_CHIP_B = { left: 34, top: 18 };
const EXTRA_LETTER_DX = 44;
const EXTRA_LETTER_DY = 36;
const EXTRA_LETTER_TOP = 8;

function locSize(
  loc: StagingLocation | undefined,
  kind: "ground" | "shelf",
): { w: number; h: number } {
  if (kind === "ground") {
    return {
      w: loc?.mapWidth ?? SHOP_MAP_GROUND_SPOT_W,
      h: loc?.mapHeight ?? SHOP_MAP_GROUND_SPOT_H,
    };
  }
  return {
    w: loc?.mapWidth ?? SHOP_MAP_SHELF_SPOT_W,
    h: loc?.mapHeight ?? SHOP_MAP_SHELF_SPOT_H,
  };
}

function putCenter(
  centers: Map<string, MapPoint>,
  slot: string,
  loc: StagingLocation | undefined,
  point: MapPoint,
): void {
  centers.set(normalizeStagingCodeKey(slot), point);
  if (loc?.code) {
    centers.set(normalizeStagingCodeKey(loc.code), point);
  }
  if (loc?.mapLayoutSlot) {
    centers.set(normalizeStagingCodeKey(loc.mapLayoutSlot), point);
  }
}

function locForSlot(
  slot: string,
  bySlot: Map<string, StagingLocation>,
  byCode: Map<string, StagingLocation>,
): StagingLocation | undefined {
  const key = normalizeStagingCodeKey(slot);
  return bySlot.get(key) ?? byCode.get(key);
}

/**
 * Canvas-space centers for every default + extra map slot, matching
 * ShopFloorMap's grid + flex + translate(offset) placement.
 */
export function resolveShopMapSpotCenters(
  locations: StagingLocation[],
  extras?: ShopMapLayoutExtras | null,
): Map<string, MapPoint> {
  const layout = resolveShopMapLayout(extras);
  const canvas = resolveShopMapCanvasSize(extras);
  const bySlot = new Map<string, StagingLocation>();
  const byCode = new Map<string, StagingLocation>();
  for (const loc of locations) {
    byCode.set(normalizeStagingCodeKey(loc.code), loc);
    if (loc.mapLayoutSlot) {
      bySlot.set(normalizeStagingCodeKey(loc.mapLayoutSlot), loc);
    }
  }

  const centers = new Map<string, MapPoint>();

  const leftItems = layout.groundLeft.map((slot) => {
    const loc = locForSlot(slot, bySlot, byCode);
    return { slot, loc, sz: locSize(loc, "ground") };
  });
  const leftWidth = leftItems.reduce(
    (max, item) => Math.max(max, item.sz.w),
    SHOP_MAP_GROUND_SPOT_W,
  );

  // column-reverse: last array item (G4) is visually at the top.
  let y = CANVAS_PAD;
  for (const item of [...leftItems].reverse()) {
    const ox = item.loc?.mapOffsetX ?? 0;
    const oy = item.loc?.mapOffsetY ?? 0;
    putCenter(centers, item.slot, item.loc, {
      x: CANVAS_PAD + ox + item.sz.w / 2,
      y: y + oy + item.sz.h / 2,
    });
    y += item.sz.h + GROUND_GAP;
  }

  const rightX0 = CANVAS_PAD + leftWidth + GRID_COL_GAP;
  const maxX = canvas.width - CANVAS_PAD;
  let x = rightX0;
  let rowY = CANVAS_PAD;
  let rowH = 0;
  for (const slot of layout.groundTop) {
    const loc = locForSlot(slot, bySlot, byCode);
    const sz = locSize(loc, "ground");
    if (x > rightX0 && x + sz.w > maxX) {
      x = rightX0;
      rowY += rowH + GROUND_GAP;
      rowH = 0;
    }
    const ox = loc?.mapOffsetX ?? 0;
    const oy = loc?.mapOffsetY ?? 0;
    putCenter(centers, slot, loc, {
      x: x + ox + sz.w / 2,
      y: rowY + oy + sz.h / 2,
    });
    x += sz.w + GROUND_GAP;
    rowH = Math.max(rowH, sz.h);
  }

  const unitInnerW = SHELF_BAY + SHELF_SPOT_COL_GAP + SHELF_SPOT_COL_W;
  const shelfTop = rowY + rowH + SHELF_BELOW_GAP;
  let unitX = rightX0 + SHELF_ROW_MARGIN_LEFT;
  for (const unit of layout.shelfUnits) {
    const unitLoc = locForSlot(unit, bySlot, byCode);
    const uox = unitLoc?.mapOffsetX ?? 0;
    const uoy = unitLoc?.mapOffsetY ?? 0;
    const letters = new Set(
      (layout.shelfLettersByUnit[unit] ?? []).map((letter) =>
        letter.toUpperCase(),
      ),
    );

    for (let i = 0; i < SHOP_MAP_SHELF_LEVELS.length; i += 1) {
      const [a, b] = SHOP_MAP_SHELF_LEVELS[i];
      const levelFromTop = SHOP_MAP_SHELF_LEVELS.length - 1 - i;
      const cellTop = shelfTop + uoy + levelFromTop * SHELF_BAY;
      const codeA = shelfSpotCode(unit, a);
      const codeB = shelfSpotCode(unit, b);
      const locA = locForSlot(codeA, bySlot, byCode);
      const locB = locForSlot(codeB, bySlot, byCode);
      const szA = locSize(locA, "shelf");
      const szB = locSize(locB, "shelf");
      if (letters.has(a)) {
        putCenter(centers, codeA, locA, {
          x:
            unitX +
            uox +
            SHELF_BAY +
            SHELF_SPOT_COL_GAP +
            SHELF_CHIP_A.left +
            (locA?.mapOffsetX ?? 0) +
            szA.w / 2,
          y: cellTop + SHELF_CHIP_A.top + (locA?.mapOffsetY ?? 0) + szA.h / 2,
        });
      }
      if (letters.has(b)) {
        putCenter(centers, codeB, locB, {
          x:
            unitX +
            uox +
            SHELF_BAY +
            SHELF_SPOT_COL_GAP +
            SHELF_CHIP_B.left +
            (locB?.mapOffsetX ?? 0) +
            szB.w / 2,
          y: cellTop + SHELF_CHIP_B.top + (locB?.mapOffsetY ?? 0) + szB.h / 2,
        });
      }
    }

    const extraLetters = (layout.shelfLettersByUnit[unit] ?? []).filter(
      (letter) =>
        !(SHOP_MAP_DEFAULT_SHELF_LETTERS as readonly string[]).includes(letter),
    );
    const extraBaseY = shelfTop + uoy + SHOP_MAP_SHELF_LEVELS.length * SHELF_BAY;
    extraLetters.forEach((letter, idx) => {
      const code = shelfSpotCode(unit, letter);
      const loc = locForSlot(code, bySlot, byCode);
      const sz = locSize(loc, "shelf");
      putCenter(centers, code, loc, {
        x:
          unitX +
          uox +
          (idx % 3) * EXTRA_LETTER_DX +
          (loc?.mapOffsetX ?? 0) +
          sz.w / 2,
        y:
          extraBaseY +
          EXTRA_LETTER_TOP +
          Math.floor(idx / 3) * EXTRA_LETTER_DY +
          (loc?.mapOffsetY ?? 0) +
          sz.h / 2,
      });
    });

    unitX += unitInnerW + SHELF_UNIT_GAP;
  }

  return centers;
}

export function mapDistance(a: MapPoint, b: MapPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function matchesSpaceTier(
  loc: StagingLocation,
  spaceTier: UnplannedSpaceTier,
): boolean {
  if (spaceTier === "shelf") {
    return (loc.type === "shelf" || loc.type === "bin") && !isOversizedSpot(loc);
  }
  if (spaceTier === "ground") {
    return loc.type === "ground" && !isOversizedSpot(loc);
  }
  return loc.type === "ground" && isOversizedSpot(loc);
}

export function resolveOriginMapPoint(
  originCode: string,
  centers: Map<string, MapPoint>,
  locations: StagingLocation[],
): MapPoint | null {
  const key = normalizeStagingCodeKey(originCode);
  if (!key) return null;
  const direct = centers.get(key);
  if (direct) return direct;
  const loc = locations.find(
    (item) =>
      normalizeStagingCodeKey(item.code) === key ||
      (item.mapLayoutSlot
        ? normalizeStagingCodeKey(item.mapLayoutSlot) === key
        : false),
  );
  if (!loc) return null;
  const fromCode = centers.get(normalizeStagingCodeKey(loc.code));
  if (fromCode) return fromCode;
  if (loc.mapLayoutSlot) {
    const fromSlot = centers.get(normalizeStagingCodeKey(loc.mapLayoutSlot));
    if (fromSlot) return fromSlot;
  }
  return null;
}

export function pickNearestAvailableStagingSpot(input: {
  originCode: string;
  spaceTier: UnplannedSpaceTier;
  locations: StagingLocation[];
  extras?: ShopMapLayoutExtras | null;
  blockedIds: Iterable<string>;
}): StagingLocation | null {
  const blocked = new Set(
    [...input.blockedIds].map((id) => id.trim()).filter(Boolean),
  );
  const centers = resolveShopMapSpotCenters(input.locations, input.extras);
  const origin = resolveOriginMapPoint(
    input.originCode,
    centers,
    input.locations,
  );
  if (!origin) return null;

  let best: { loc: StagingLocation; distance: number } | null = null;
  for (const loc of input.locations) {
    if (!isLocationActive(loc)) continue;
    if (blocked.has(loc.id)) continue;
    if (!matchesSpaceTier(loc, input.spaceTier)) continue;
    const point =
      centers.get(normalizeStagingCodeKey(loc.code)) ??
      (loc.mapLayoutSlot
        ? centers.get(normalizeStagingCodeKey(loc.mapLayoutSlot))
        : undefined);
    if (!point) continue;
    const distance = mapDistance(origin, point);
    if (
      !best ||
      distance < best.distance - 0.01 ||
      (Math.abs(distance - best.distance) <= 0.01 &&
        loc.code.localeCompare(best.loc.code) < 0)
    ) {
      best = { loc, distance };
    }
  }
  return best?.loc ?? null;
}
