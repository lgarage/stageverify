/**
 * Pure pickup staging release — strip picked spots from live fields and
 * keep them on pickedUpStagingLocationIds for drawer history.
 */

export type PickupStagingFields = {
  stagingLocationId?: string;
  additionalStagingLocationIds?: string[];
  plannedStagingLocationIds?: string[];
  combinationStagingGroupId?: string;
  combinationMemberLocationIds?: string[];
};

function nonEmptyUnpicked(
  ids: string[] | undefined,
  picked: Set<string>,
): string[] {
  const out: string[] = [];
  for (const raw of ids ?? []) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || picked.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Capture picked spots as history and drop them from live occupancy fields.
 * Full pickup also clears combination grouping.
 */
export function buildPickupLiveStagingPatch(
  delivery: PickupStagingFields,
  pickedUpStagingLocationIds: string[],
  fullyPicked: boolean,
): Record<string, unknown> {
  const history = [
    ...new Set(
      pickedUpStagingLocationIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ];
  const picked = new Set(history);

  if (fullyPicked) {
    return {
      stagingLocationId: "",
      additionalStagingLocationIds: [],
      plannedStagingLocationIds: [],
      combinationStagingGroupId: "",
      combinationMemberLocationIds: [],
      pickedUpStagingLocationIds: history,
    };
  }

  const nextPrimary =
    delivery.stagingLocationId &&
    !picked.has(delivery.stagingLocationId.trim())
      ? delivery.stagingLocationId.trim()
      : "";
  const nextAdditional = nonEmptyUnpicked(
    delivery.additionalStagingLocationIds,
    picked,
  ).filter((id) => id !== nextPrimary);
  const nextPlanned = nonEmptyUnpicked(
    delivery.plannedStagingLocationIds,
    picked,
  );
  const nextCombo = nonEmptyUnpicked(
    delivery.combinationMemberLocationIds,
    picked,
  );

  return {
    stagingLocationId: nextPrimary,
    additionalStagingLocationIds: nextAdditional,
    plannedStagingLocationIds: nextPlanned,
    combinationMemberLocationIds: nextCombo,
    combinationStagingGroupId:
      nextCombo.length > 0
        ? (delivery.combinationStagingGroupId ?? "").trim()
        : "",
    pickedUpStagingLocationIds: history,
  };
}
