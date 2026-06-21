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

export function buildSuggestedResolutionNote(
  issue: MaterialIssue,
  resolutionType: IssueResolutionType,
  orderNumber?: string | null,
): string {
  const issueLabel = MATERIAL_ISSUE_TYPE_LABEL[issue.type];
  const resolutionLabel = ISSUE_RESOLUTION_TYPE_LABEL[resolutionType];
  const desc = issue.description?.trim() || "reported issue";
  const orderPart = orderNumber ? ` for ${orderNumber}` : "";
  return `${resolutionLabel}${orderPart}: ${issueLabel} — ${desc}. Recorded for technician and pickup readiness.`;
}
