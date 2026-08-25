import type { DeliveryOrder, Item, MaterialIssue, StagingLocation } from "../models";
import {
  formatActualStagingCodes,
  formatPlannedStagingCodes,
} from "../deliveryDisplayHelpers";

export type SnapshotTone = "ok" | "neutral" | "attention";

export interface SnapshotLabel {
  label: string;
  tone: SnapshotTone;
}

const OPEN_ISSUE_STATUSES = new Set(["open", "assigned"]);

export function computeItemConflicts(
  items: Item[],
  itemsReceivedCount: number,
  vendorClaimsDelivered: boolean,
): Item[] {
  return items.filter((item) => {
    if (item.qtyDamaged > 0 || item.qtyBackordered > 0) return true;
    if (item.qtyMissing > 0) {
      if (itemsReceivedCount === 0 && !vendorClaimsDelivered) return false;
      return true;
    }
    return false;
  });
}

export function buildStagingEvidenceSnapshot(input: {
  delivery: Pick<
    DeliveryOrder,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
  >;
  stagingLocation?: StagingLocation | null;
  stagingLocations: StagingLocation[];
}): SnapshotLabel {
  const locById = new Map(input.stagingLocations.map((loc) => [loc.id, loc]));

  if (input.stagingLocation) {
    const loc = input.stagingLocation;
    const locationLabel =
      loc.label && loc.label !== loc.code
        ? `${loc.code} — ${loc.label}`
        : loc.code;
    return {
      label: `Assigned to ${locationLabel}`,
      tone: "ok",
    };
  }

  const plannedIds = input.delivery.plannedStagingLocationIds ?? [];
  if (plannedIds.length > 0) {
    const codes = formatPlannedStagingCodes(
      input.delivery as DeliveryOrder,
      locById,
    );
    if (codes && codes !== "—") {
      return {
        label: `Planned at ${codes}`,
        tone: "attention",
      };
    }
  }

  const actualCodes = formatActualStagingCodes(
    input.delivery as DeliveryOrder,
    locById,
  );
  if (actualCodes) {
    return {
      label: `Assigned to ${actualCodes}`,
      tone: "ok",
    };
  }

  return { label: "Not Assigned", tone: "neutral" };
}

export function buildMaterialIssuesEvidenceSnapshot(input: {
  materialIssues: MaterialIssue[];
  itemConflicts: Item[];
}): SnapshotLabel {
  const openIssues = input.materialIssues.filter((issue) =>
    OPEN_ISSUE_STATUSES.has(issue.status),
  );
  const blockingIssues = openIssues.filter((issue) => issue.blocking);

  if (openIssues.length > 0) {
    const suffix =
      blockingIssues.length > 0
        ? ` (${blockingIssues.length} blocking)`
        : "";
    return {
      label: `Open Issues${suffix}`,
      tone: "attention",
    };
  }

  const missingItems = input.itemConflicts.filter((item) => item.qtyMissing > 0);
  if (missingItems.length > 0) {
    return { label: "Items Missing", tone: "attention" };
  }

  if (input.itemConflicts.length > 0) {
    const backorderOnly = input.itemConflicts.every(
      (item) =>
        item.qtyBackordered > 0 &&
        item.qtyMissing === 0 &&
        item.qtyDamaged === 0,
    );
    if (backorderOnly) {
      const backorderedLines = input.itemConflicts.filter(
        (item) => item.qtyBackordered > 0,
      );
      const label =
        backorderedLines.length === 1
          ? "1 backordered item"
          : "Backordered items";
      return { label, tone: "attention" };
    }
    return { label: "Line exceptions", tone: "attention" };
  }

  return { label: "None", tone: "neutral" };
}

export function buildPhysicalDeliveryEvidenceSnapshot(input: {
  physicalDropoffComplete: boolean;
  vendorPhysicalDropoffConfirmed: boolean;
  itemConflicts: Item[];
}): SnapshotLabel {
  if (input.physicalDropoffComplete) {
    return { label: "Confirmed", tone: "ok" };
  }
  if (input.vendorPhysicalDropoffConfirmed) {
    if (input.itemConflicts.length > 0) {
      return {
        label: "Vendor Marked Delivered — incomplete",
        tone: "attention",
      };
    }
    return { label: "Vendor Marked Delivered", tone: "attention" };
  }
  return { label: "Not Confirmed", tone: "neutral" };
}
