import type { IssueResolutionType, MaterialIssue } from "../models";
import {
  ISSUE_RESOLUTION_TYPE_LABEL,
  MATERIAL_ISSUE_TYPE_LABEL,
} from "../models";

const UNKNOWN_ETA_PATTERN =
  /unknown eta|no eta|eta unknown|delivery date unknown|when will|no delivery date/i;
const LOCAL_SUPPLY_PATTERN =
  /supply house|local supply|pick up at|pickup at supply/i;
const MISSING_SHIPMENT_PATTERN = /missing|short shipment|partial ship/i;

export function defaultResolutionTypeForIssue(
  issue: MaterialIssue,
): IssueResolutionType {
  const desc = (issue.description ?? "").toLowerCase();

  if (UNKNOWN_ETA_PATTERN.test(desc)) {
    return "need_more_information";
  }
  if (LOCAL_SUPPLY_PATTERN.test(desc)) {
    return "pick_up_supply_house";
  }

  switch (issue.type) {
    case "missing":
    case "wrong_item":
    case "damaged":
      return "vendor_redeliver";
    case "backordered":
      return "vendor_redeliver";
    case "running_low":
      return "pick_up_supply_house";
    default:
      if (MISSING_SHIPMENT_PATTERN.test(desc)) {
        return "vendor_redeliver";
      }
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
    case "need_more_information":
      return "Email vendor for clarification; update delivery when response received.";
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
  lines.push(`Issue: ${issueLabel} — ${desc}`);

  if (context?.orderNumber || context?.jobNumber) {
    const parts: string[] = [];
    if (context.orderNumber) parts.push(context.orderNumber);
    if (context.jobNumber) parts.push(`job ${context.jobNumber}`);
    lines.push(`Delivery: ${parts.join(" for ")}`);
  }

  if (context?.missingItems && context.missingItems.length > 0) {
    lines.push("Missing Items:");
    for (const m of context.missingItems) {
      lines.push(
        `- ${m.description} (${m.qtyMissing} missing of ${m.qtyOrdered} ordered)`,
      );
    }
  }

  lines.push(`Suggested Resolution: ${resolutionLabel}`);
  lines.push(`Next Step: ${nextStepForResolution(resolutionType)}`);

  return lines.join("\n");
}

/** Readable text on white inputs inside dispatcher modals. */
export const DRAWER_MODAL_INPUT_STYLE = {
  color: "#111827",
  backgroundColor: "#fff",
} as const;

/** Field labels on white modal panels — body inherits light text otherwise. */
export const DRAWER_MODAL_LABEL_STYLE = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  color: "#0a3161",
  textAlign: "left",
} as const;
