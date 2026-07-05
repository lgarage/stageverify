/**
 * Unit tests: parsed inspect modal review summary when site delivery is confirmed.
 */
import { buildExpectedJohnstoneFieldChecklist } from "../src/dispatcher/invoice/invoiceExpectedFieldsChecklist.ts";

function assert(label, condition) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

const approvedImport = {
  id: "import-1",
  inboundEmailProcessingId: "inbound-1",
  gmailMessageId: "msg-1",
  importBatchId: "batch-1",
  pageId: "inv-so-4046362",
  reviewStatus: "approved",
  importStatus: "pending",
  confidenceScore: 0.85,
  humanReviewRequired: true,
  importDecisionMode: "review_required",
  suggestedAction: "Review required — inspect fields and match before approve.",
  reviewRequiredReasons: ["Low confidence"],
  parsedHeader: { vendorOrderNumber: "4046362" },
  parsedLines: [{ lineNumber: 1, lineType: "product", vendorProductNumber: "ABC" }],
  parsedLineCount: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const withoutSite = buildExpectedJohnstoneFieldChecklist(approvedImport);
assert(
  "approved import without site context — approval eligible No",
  withoutSite.approvalEligibleLabel === "No",
);
assert(
  "approved import without site context — shows auto-import suggestion",
  withoutSite.hideAutoImportSuggestion === false,
);

const withSite = buildExpectedJohnstoneFieldChecklist(approvedImport, {
  deliverToSiteConfirmed: true,
});
assert(
  "site-confirmed — approval eligible N/A",
  withSite.approvalEligibleLabel === "N/A",
);
assert(
  "site-confirmed — hides auto-import suggestion panel",
  withSite.hideAutoImportSuggestion === true,
);
assert("site-confirmed — approvalEligible flag false", withSite.approvalEligible === false);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All parsed-inspect site-confirmed tests passed.");
