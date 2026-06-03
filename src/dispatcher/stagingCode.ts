import type { StagingLocation } from "./models";

/** Loose match key: strip dashes/spaces, uppercase (s1-a → S1A). */
export function normalizeStagingCodeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Canonical code for storage/display (s1a → S1-A, g2 → G2). */
export function formatStagingCodeCanonical(raw: string): string {
  const key = normalizeStagingCodeKey(raw);
  if (!key) return raw.trim();

  const shelfBin = /^S(\d+)([A-Z])$/.exec(key);
  if (shelfBin) return `S${shelfBin[1]}-${shelfBin[2]}`;

  const ground = /^G(\d+)$/.exec(key);
  if (ground) return `G${ground[1]}`;

  return key;
}

export function stagingCodesMatch(a: string, b: string): boolean {
  return normalizeStagingCodeKey(a) === normalizeStagingCodeKey(b);
}

export function findStagingLocationByCode(
  locations: StagingLocation[],
  input: string,
): StagingLocation | undefined {
  const key = normalizeStagingCodeKey(input);
  if (!key) return undefined;
  return locations.find((loc) => normalizeStagingCodeKey(loc.code) === key);
}
