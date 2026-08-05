/**
 * User-rejected invoice imports must survive Gmail reparse/sync — not reopen as pending.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "functions", "package.json"));

const {
  isSystemAutoRejectedImport,
  isSystemIgnoreSkipReason,
} = require(path.join(root, "functions/lib/invoice/creditReturnSkip.js"));

assert.equal(isSystemIgnoreSkipReason("credit_return"), true);

assert.equal(
  isSystemAutoRejectedImport({
    reviewStatus: "rejected",
    rejectedBy: "system:document_ignore_skip",
  }),
  true,
);
assert.equal(
  isSystemAutoRejectedImport({
    reviewStatus: "rejected",
    rejectedBy: "system:credit_return_skip",
  }),
  true,
);

// User manual reject (including credit/return with skipReason) — must NOT be treated as system auto-skip.
assert.equal(
  isSystemAutoRejectedImport({
    reviewStatus: "rejected",
    rejectedBy: "dispatcher-uid-abc",
    skipReason: "credit_return",
  }),
  false,
);
assert.equal(
  isSystemAutoRejectedImport({
    reviewStatus: "rejected",
    rejectedBy: "dispatcher-uid-abc",
  }),
  false,
);
assert.equal(
  isSystemAutoRejectedImport({
    reviewStatus: "pending_review",
    rejectedBy: "dispatcher-uid-abc",
  }),
  false,
);

console.log("PASS: preserve-user-rejected-import guards");
