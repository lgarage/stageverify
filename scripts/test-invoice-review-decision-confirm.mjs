/**
 * Unit tests for invoice review approve/reject decision confirm state machine.
 * Run: npm run test:invoice-review-decision-confirm
 */
import assert from "node:assert/strict";
import {
  reduceDecisionConfirm,
} from "../src/dispatcher/invoice/invoiceReviewDecisionConfirm.ts";

// 1. tap-approve → confirm visible (state=approve), no fire
{
  const r = reduceDecisionConfirm(null, "tap-approve");
  assert.equal(r.next, "approve");
  assert.equal(r.fire, undefined);
}

// 2. confirm approve → fire "approve" exactly once
{
  const r = reduceDecisionConfirm("approve", "confirm");
  assert.equal(r.next, null);
  assert.equal(r.fire, "approve");
}

// 3. cancel from approve confirm → no fire
{
  const r = reduceDecisionConfirm("approve", "cancel");
  assert.equal(r.next, null);
  assert.equal(r.fire, undefined);
}

// 4. tap-reject → state=reject, no fire
{
  const r = reduceDecisionConfirm(null, "tap-reject");
  assert.equal(r.next, "reject");
  assert.equal(r.fire, undefined);
}

// 5. confirm reject → fire "reject" exactly once
{
  const r = reduceDecisionConfirm("reject", "confirm");
  assert.equal(r.next, null);
  assert.equal(r.fire, "reject");
}

// 6. cancel from reject confirm → no fire
{
  const r = reduceDecisionConfirm("reject", "cancel");
  assert.equal(r.next, null);
  assert.equal(r.fire, undefined);
}

// 7. locked/pending → confirm does not fire twice
{
  const r = reduceDecisionConfirm("approve", "confirm", { locked: true });
  assert.equal(r.next, "approve");
  assert.equal(r.fire, undefined);
}

// 8. tap-approve while already confirming → no second fire / stay
{
  const r = reduceDecisionConfirm("reject", "tap-approve");
  assert.equal(r.next, "reject");
  assert.equal(r.fire, undefined);
}

// confirm while idle → no fire
{
  const r = reduceDecisionConfirm(null, "confirm");
  assert.equal(r.next, null);
  assert.equal(r.fire, undefined);
}

// 9. after confirm fires → idle; second confirm does not fire again
{
  const first = reduceDecisionConfirm("approve", "confirm");
  assert.equal(first.fire, "approve");
  assert.equal(first.next, null);
  const second = reduceDecisionConfirm(first.next, "confirm");
  assert.equal(second.fire, undefined);
  assert.equal(second.next, null);
}

console.log("test-invoice-review-decision-confirm: PASS");
