import type { DeliveryDetails } from "../models";
import { MATERIAL_ISSUE_TYPE_LABEL } from "../models";

export function buildNeedMoreInfoDraft(details: DeliveryDetails): string | null {
  const { delivery, job, vendor, items, materialIssues } = details;
  if (!job) return null;

  const openIssues = materialIssues.filter(
    (i) => i.status === "open" || i.status === "assigned",
  );
  const missing = items.filter((i) => i.qtyMissing > 0);

  if (missing.length === 0 && openIssues.length === 0) return null;

  const lines = [
    `Subject: Question about ${delivery.orderNumber ?? "delivery"} — ${job.jobName}`,
    "",
    `Hi ${vendor.contactName ?? vendor.name},`,
    "",
    `We're reviewing delivery ${delivery.orderNumber ?? ""} for job ${job.jobNumber} (${job.jobName}) and need clarification:`,
  ];

  if (missing.length > 0) {
    lines.push("", "Missing items:");
    for (const item of missing) {
      lines.push(
        `- ${item.description} (${item.qtyMissing} missing of ${item.qtyOrdered} ordered)`,
      );
    }
  }

  if (openIssues.length > 0) {
    lines.push("", "Open issues:");
    for (const issue of openIssues) {
      lines.push(
        `- ${MATERIAL_ISSUE_TYPE_LABEL[issue.type]}: ${issue.description?.trim() || "—"}`,
      );
    }
  }

  lines.push("", "Please reply with updated delivery status or ETA.", "", "Thank you,");
  return lines.join("\n");
}
