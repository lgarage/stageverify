import type { LocationLayout, LocationSpot } from "./customerModels";
import { newSpotId } from "./operatorIds";

export function copyAddress<T extends Record<string, string | undefined>>(
  address: T,
): T {
  return { ...address };
}

export function buildLocationLayout(input: {
  customerId: string;
  locationId: string;
  groundSpotCount: number;
  shelfSpotCount: number;
  nowIso: string;
}): LocationLayout {
  const spots: LocationSpot[] = [];

  for (let i = 1; i <= input.groundSpotCount; i += 1) {
    spots.push({
      spotId: newSpotId(),
      customerId: input.customerId,
      locationId: input.locationId,
      visibleLabel: `G${i}`,
      kind: "ground",
      qrToken: null,
      createdAt: input.nowIso,
    });
  }

  for (let i = 1; i <= input.shelfSpotCount; i += 1) {
    spots.push({
      spotId: newSpotId(),
      customerId: input.customerId,
      locationId: input.locationId,
      visibleLabel: `S${i}`,
      kind: "shelf",
      qrToken: null,
      createdAt: input.nowIso,
    });
  }

  return {
    customerId: input.customerId,
    locationId: input.locationId,
    spots,
  };
}

export function spotCountsFromLayout(layout: LocationLayout): {
  ground: number;
  shelf: number;
  total: number;
} {
  const ground = layout.spots.filter((s) => s.kind === "ground").length;
  const shelf = layout.spots.filter((s) => s.kind === "shelf").length;
  return { ground, shelf, total: ground + shelf };
}
