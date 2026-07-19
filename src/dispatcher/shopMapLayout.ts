/** Jake shop floor layout — hardcoded v1 geometry (visual polish may change). */

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

/** Each shelf unit: 2 rows × 6 cols — top A–F, bottom G–L (CAD-style cubbies). */
export const SHOP_MAP_SHELF_LEVELS = [
  ["A", "G"],
  ["B", "H"],
  ["C", "I"],
  ["D", "J"],
  ["E", "K"],
  ["F", "L"],
] as const;

export const SHOP_MAP_SHELF_UNITS = ["S1", "S2"] as const;

export function shelfSpotCode(
  unit: (typeof SHOP_MAP_SHELF_UNITS)[number],
  letter: string,
): string {
  return `${unit}${letter}`;
}

export function allShopMapSpotCodes(): string[] {
  const shelf = SHOP_MAP_SHELF_UNITS.flatMap((unit) =>
    SHOP_MAP_SHELF_LEVELS.flatMap(([a, b]) => [
      shelfSpotCode(unit, a),
      shelfSpotCode(unit, b),
    ]),
  );
  return [...SHOP_MAP_GROUND_CODES, ...shelf];
}
