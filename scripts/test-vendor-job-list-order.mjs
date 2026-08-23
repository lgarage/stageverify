import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const helperSource = readFileSync(
  resolve(process.cwd(), "src/dispatcher/vendorJobListOrder.ts"),
  "utf8",
);
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperJavaScript).toString("base64")}`
);
const { isVendorJobCardDelivered, orderVendorJobsDeliveredLast } = helperModule;

function row(id, delivered) {
  return { id, vendorPhysicalDropoffConfirmed: delivered };
}

const source = [
  row("u1", false),
  row("d1", true),
  row("u2", false),
  row("d2", true),
  row("u3", false),
];
const originalIds = source.map((r) => r.id);

const unfinishedOnly = [row("a", false), row("b", false), row("c", false)];
assert.deepEqual(
  orderVendorJobsDeliveredLast(unfinishedOnly).map((r) => r.id),
  ["a", "b", "c"],
  "all unfinished jobs only → existing order preserved",
);

const deliveredOnly = [row("d1", true), row("d2", true), row("d3", true)];
assert.deepEqual(
  orderVendorJobsDeliveredLast(deliveredOnly).map((r) => r.id),
  ["d1", "d2", "d3"],
  "all delivered jobs only → existing order preserved",
);

const mixed = orderVendorJobsDeliveredLast(source);
assert.deepEqual(
  mixed.map((r) => r.id),
  ["u1", "u2", "u3", "d1", "d2"],
  "mixed unfinished + delivered → unfinished first, delivered bottom",
);
assert.ok(
  mixed.slice(0, 3).every((r) => r.vendorPhysicalDropoffConfirmed === false),
  "multiple unfinished jobs remain above delivered jobs",
);
assert.ok(
  mixed.slice(3).every((r) => r.vendorPhysicalDropoffConfirmed === true),
  "multiple delivered jobs grouped together at bottom",
);

assert.deepEqual(
  source.map((r) => r.id),
  originalIds,
  "source array is not mutated",
);

const exceptionLike = [
  row("partial", false),
  row("exception", false),
  row("backorder", false),
  row("done", true),
];
assert.deepEqual(
  orderVendorJobsDeliveredLast(exceptionLike).map((r) => r.id),
  ["partial", "exception", "backorder", "done"],
  "partial / exception / backorder stay unfinished unless the card flag is true",
);

assert.equal(isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: true }), true);
assert.equal(isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: false }), false);
assert.equal(isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: undefined }), false);
assert.equal(isVendorJobCardDelivered({}), false);
assert.equal(
  isVendorJobCardDelivered({ vendorPhysicalDropoffConfirmed: null }),
  false,
  "null is not delivered — matches card === true check",
);

const timestampOnly = {
  id: "stale",
  vendorPhysicalDropoffConfirmed: false,
  vendorPhysicalDropoffConfirmedAt: "2026-08-01T00:00:00.000Z",
};
assert.equal(
  isVendorJobCardDelivered(timestampOnly),
  false,
  "timestamp alone does not count — cards use the boolean, not hub isVendorDeliveryConfirmed",
);
assert.equal(orderVendorJobsDeliveredLast([timestampOnly, row("d", true)])[0].id, "stale");

console.log("PASS: test-vendor-job-list-order (9 cases)");
