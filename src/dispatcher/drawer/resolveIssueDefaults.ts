import type { IssueResolutionType, MaterialIssue } from "../models";
import {
  ISSUE_RESOLUTION_TYPE_LABEL,
  MATERIAL_ISSUE_TYPE_LABEL,
} from "../models";

export function defaultResolutionTypeForIssue(
  issue: MaterialIssue,
): IssueResolutionType {
  switch (issue.type) {
    case "missing":
      return "found_in_shop";
    case "backordered":
    case "damaged":
    case "wrong_item":
      return "vendor_redeliver";
    default:
      return "other";
  }
}

function nextStepForResolution(type: IssueResolutionType): string {
  switch (type) {
    case "found_in_shop":
      return "Item located in shop — update staging and confirm pickup readiness.";
    case "pick_up_supply_house":
      return "Technician to pick up at supply house; update receipt when back on site.";
    case "vendor_redeliver":
      return "Contact vendor for redelivery; update receipt when items arrive.";
    case "substitute":
      return "Substitute approved — confirm substitute on staging and notify technician.";
    case "transfer":
      return "Transfer arranged — confirm items at destination staging.";
    case "continue_without":
      return "Job may proceed without item — document waiver for technician.";
    case "hold_job":
      return "Hold job until issue cleared — notify technician and dispatcher.";
    default:
      return "Document outcome and confirm readiness before pickup.";
  }
}

export interface SuggestedResolutionContext {
  orderNumber?: string | null;
  jobNumber?: string | null;
  missingItems?: { description: string; qtyMissing: number; qtyOrdered: number }[];
}

export function buildSuggestedResolutionNote(
  issue: MaterialIssue,
  resolutionType: IssueResolutionType,
  context?: SuggestedResolutionContext,
): string {
  const issueLabel = MATERIAL_ISSUE_TYPE_LABEL[issue.type];
  const resolutionLabel = ISSUE_RESOLUTION_TYPE_LABEL[resolutionType];
  const desc = issue.description?.trim() || "reported issue";

  const lines: string[] = [];
  lines.push(`Issue: ${issueLabel} — ${desc}.`);

  if (context?.orderNumber || context?.jobNumber) {
    const parts: string[] = [];
    if (context.orderNumber) parts.push(`delivery ${context.orderNumber}`);
    if (context.jobNumber) parts.push(`job ${context.jobNumber}`);
    lines.push(`Delivery: ${parts.join(" for ")}.`);
  }

  if (context?.missingItems && context.missingItems.length > 0) {
    const missingPart = context.missingItems
      .map(
        (m) =>
          `${m.description} (${m.qtyMissing} missing of ${m.qtyOrdered} ordered)`,
      )
      .join("; ");
    lines.push(`Missing from receipt: ${missingPart}.`);
  }

  lines.push(`Resolution: ${resolutionLabel}.`);
  lines.push(`Next step: ${nextStepForResolution(resolutionType)}.`);

  return lines.join("\n");
}

/** Readable text on white inputs inside dispatcher modals. */
export const DRAWER_MODAL_INPUT_STYLE = {
  color: "#111827",
  backgroundColor: "#fff",
} as const;
