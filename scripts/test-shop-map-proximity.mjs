/**
 * Pure unit tests for Staging Map canvas-space nearest-spot helper.
 * Usage: npx tsx scripts/test-shop-map-proximity.mjs
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const mod = await import(
  resolve(process.cwd(), "src/dispatcher/shopMapProximity.ts")
);
const { pickNearestAvailableStagingSpot, resolveShopMapSpotCenters } = mod;

function loc(partial) {
  return {
    status: "Active",
    label: partial.code,
    ...partial,
  };
}

function ground(code, id = code.toLowerCase()) {
  return loc({ id, code, type: "ground", widthFt: 4, depthFt: 4 });
}

function xl(code, id = `${code.toLowerCase()}-xl`) {
  return loc({ id, code, type: "ground", widthFt: 8, depthFt: 8 });
}

function shelf(code, id = code.toLowerCase()) {
  return loc({ id, code, type: "shelf", widthFt: 2, depthFt: 2 });
}

const defaultGround = [
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
].map((code) => ground(code));

const defaultShelves = ["S1", "S2"].flatMap((unit) =>
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map((letter) =>
    shelf(`${unit}${letter}`),
  ),
);

const all = [...defaultGround, ...defaultShelves, xl("G8")];

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

check("G4 is closer to G1 than G5 (column, not name)", () => {
  const centers = resolveShopMapSpotCenters(defaultGround);
  const g1 = centers.get("G1");
  const g4 = centers.get("G4");
  const g5 = centers.get("G5");
  assert.ok(g1 && g4 && g5, "default ground centers exist");
  const d14 = Math.hypot(g1.x - g4.x, g1.y - g4.y);
  const d15 = Math.hypot(g1.x - g5.x, g1.y - g5.y);
  assert.ok(d14 < d15, `G1→G4 (${d14}) should be < G1→G5 (${d15})`);
});

check("scanned G1 + Ground + G1 free → G1", () => {
  const pick = pickNearestAvailableStagingSpot({
    originCode: "G1",
    spaceTier: "ground",
    locations: defaultGround,
    blockedIds: [],
  });
  assert.equal(pick?.code, "G1");
});

check("scanned G1 + Ground + G1 occupied → G2", () => {
  const pick = pickNearestAvailableStagingSpot({
    originCode: "G1",
    spaceTier: "ground",
    locations: defaultGround,
    blockedIds: ["g1"],
  });
  assert.equal(pick?.code, "G2");
});

check("scanned G12 + Ground + G12 occupied → G11 not G1", () => {
  const pick = pickNearestAvailableStagingSpot({
    originCode: "G12",
    spaceTier: "ground",
    locations: defaultGround,
    blockedIds: ["g12"],
  });
  assert.equal(pick?.code, "G11");
});

check("different origins produce different ground suggestions", () => {
  const fromG1 = pickNearestAvailableStagingSpot({
    originCode: "G1",
    spaceTier: "ground",
    locations: defaultGround,
    blockedIds: ["g1", "g2"],
  });
  const fromG12 = pickNearestAvailableStagingSpot({
    originCode: "G12",
    spaceTier: "ground",
    locations: defaultGround,
    blockedIds: ["g12", "g11"],
  });
  assert.ok(fromG1 && fromG12);
  assert.notEqual(fromG1.code, fromG12.code);
});

check("scanned G1 + Shelf → an S1 cubby, not S2", () => {
  const pick = pickNearestAvailableStagingSpot({
    originCode: "G1",
    spaceTier: "shelf",
    locations: all,
    blockedIds: [],
  });
  assert.ok(pick, "shelf suggestion");
  assert.match(pick.code, /^S1/);
});

check("occupied + inactive + wrong type skipped", () => {
  const locations = [
    ...defaultGround,
    loc({
      id: "dead",
      code: "G2",
      type: "ground",
      status: "Planned",
      widthFt: 4,
      depthFt: 4,
    }),
    shelf("S1A"),
  ];
  const pick = pickNearestAvailableStagingSpot({
    originCode: "G1",
    spaceTier: "ground",
    locations,
    blockedIds: ["g1", "g2"],
  });
  assert.equal(pick?.code, "G3");
});

check("Large / Oversize uses XL ground only", () => {
  const pick = pickNearestAvailableStagingSpot({
    originCode: "G1",
    spaceTier: "large",
    locations: all,
    blockedIds: [],
  });
  assert.equal(pick?.code, "G8");
  assert.ok((pick.widthFt ?? 0) >= 8);
});

check("unknown origin (not on map) returns null", () => {
  const pick = pickNearestAvailableStagingSpot({
    originCode: "UV",
    spaceTier: "ground",
    locations: defaultGround,
    blockedIds: [],
  });
  assert.equal(pick, null);
});

check("mapOffsetX/Y is applied to the map center", () => {
  const base = resolveShopMapSpotCenters(defaultGround).get("G5");
  const shifted = resolveShopMapSpotCenters(
    defaultGround.map((item) =>
      item.code === "G5"
        ? { ...item, mapOffsetX: -40, mapOffsetY: 25 }
        : item,
    ),
  ).get("G5");
  assert.ok(base && shifted);
  assert.equal(Math.round(shifted.x - base.x), -40);
  assert.equal(Math.round(shifted.y - base.y), 25);
});

console.log(`\n${passed}/${passed + failed} shop-map proximity checks passed`);
if (failed > 0) process.exit(1);
