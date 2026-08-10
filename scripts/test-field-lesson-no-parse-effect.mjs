/**
 * Lane C C3-D.1 — static no-parse-effect: parsers/eligibility must not import lesson modules.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const FORBIDDEN_IMPORT =
  /vendorInvoiceFieldLessons|evaluateFieldLessonCandidate|labelAnchorAllowlist|patternFingerprint|fieldLessonAudit|fieldLessonLifecycle|setVendorInvoiceFieldLessonStatus|listVendorInvoiceFieldLessons|evaluateVendorInvoiceFieldLesson/;

const FORBIDDEN_DIRS = [
  "functions/src/invoice/parseJohnstoneInvoice.ts",
  "functions/src/invoice/parseFirstSupplyInvoice.ts",
  "functions/src/invoice/parseCanonicalInvoice.ts",
  "functions/src/invoice/vendorInvoiceRouter.ts",
  "functions/src/invoice/processInvoicePage.ts",
  "functions/src/invoice/computeAutoImportEligibility.ts",
  "functions/src/invoice/reviewChat/applyInvoiceReviewFieldCorrection.ts",
  "functions/src/invoice/reviewChat/classifyCorrectionEvidence.ts",
  "functions/src/invoice/reviewChat/indexFieldLessonExample.ts",
  "functions/src/invoice/reviewChat/correctionAllowlist.ts",
  "src/dispatcher/invoice/parseJohnstoneInvoice.ts",
  "src/dispatcher/invoice/parseFirstSupplyInvoice.ts",
  "src/dispatcher/invoice/parseCanonicalInvoice.ts",
  "src/dispatcher/invoice/processInvoicePage.ts",
];

let passed = 0;
for (const rel of FORBIDDEN_DIRS) {
  const full = path.join(root, rel);
  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    console.log(`  · skip missing ${rel}`);
    continue;
  }
  assert.equal(
    FORBIDDEN_IMPORT.test(text),
    false,
    `${rel} must not import C3-D lesson modules`,
  );
  passed += 1;
  console.log(`  ✓ ${rel} clean`);
}

// Ensure D.1 modules never write status active
const lessonFiles = [
  "functions/src/invoice/reviewChat/evaluateFieldLessonCandidate.ts",
  "functions/src/invoice/reviewChat/vendorInvoiceFieldLessons.ts",
  "functions/src/evaluateVendorInvoiceFieldLessonScopeApi.ts",
  "functions/src/listVendorInvoiceFieldLessonsApi.ts",
];
for (const rel of lessonFiles) {
  const text = readFileSync(path.join(root, rel), "utf8");
  assert.equal(
    /status:\s*["']active["']/.test(text),
    false,
    `${rel} must not assign status active`,
  );
  console.log(`  ✓ ${rel} no active status write`);
  passed += 1;
}

console.log(`\nfield-lesson-no-parse-effect: ${passed} checks passed`);
