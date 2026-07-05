/**
 * Unit tests — invoice shell staging exemption + job name resolution.
 * Usage: node scripts/test-invoice-shell-display.mjs
 */
import {
  extractDeliverToSiteLabel,
  isInvoiceShellNoShopStaging,
  jobNameFromInvoiceContext,
  resolveShellDeliveryStatus,
} from "../src/dispatcher/invoice/invoiceShellDisplayHelpers.ts";

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

assert(
  "DELIVER TO extracted from order notes",
  extractDeliverToSiteLabel(["DELIVER TO: Planet Fitness Hartford"]) ===
    "Planet Fitness Hartford",
);

assert(
  "job name prefers DELIVER TO over PO tokens",
  jobNameFromInvoiceContext("blackduck hartfo", [
    "DELIVER TO: Planet Fitness Hartford",
  ]) === "Planet Fitness Hartford",
);

assert(
  "pickup_at_vendor skips shop staging",
  isInvoiceShellNoShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: true,
    status: "complete",
  }),
);

assert(
  "deliver-to-site skips shop staging",
  isInvoiceShellNoShopStaging({
    invoiceDeliverToSite: true,
    invoiceImportStatus: "pending",
    status: "complete",
    createdFromInvoiceImport: true,
  }),
);

assert(
  "normal pending shop delivery still requires staging action path",
  !isInvoiceShellNoShopStaging({
    invoiceImportStatus: "pending",
    status: "pending",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "pickup_at_vendor alone does not skip staging without invoice shell marker",
  !isInvoiceShellNoShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "canonical shell delivery id exempts staging when deliver-to-site",
  isInvoiceShellNoShopStaging({
    id: "delivery-vii-test-import-1",
    invoiceDeliverToSite: true,
    invoiceImportStatus: "pending",
    status: "complete",
  }),
);

assert(
  "deliver-to-site pending import maps to complete delivery status",
  resolveShellDeliveryStatus("pending", "delivery", true) === "complete",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
