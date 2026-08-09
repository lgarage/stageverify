/** Shared staging id sanitize — approve + draft staging override paths. */
export const MAX_PLANNED_STAGING_IDS = 20;

export function sanitizePlannedStagingLocationIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 128),
    ),
  ].slice(0, MAX_PLANNED_STAGING_IDS);
}
