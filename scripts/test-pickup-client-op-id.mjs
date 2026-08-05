/**
 * Assert pickup clientOperationId fits CF recordPickupEvent limits.
 * Legacy drawer IDs like pickup-delivery-vii-{importId}-{uuid} exceed 64 chars.
 */
import assert from "node:assert/strict";

const MAX_LEN = 64;
const PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function newPickupClientOperationId() {
  return `op-${crypto.randomUUID()}`;
}

function resolvePickupClientOperationId(provided) {
  const trimmed = provided?.trim();
  if (trimmed && trimmed.length <= MAX_LEN && PATTERN.test(trimmed)) {
    return trimmed;
  }
  return newPickupClientOperationId();
}

const legacyShellDeliveryId = "delivery-vii-abc123import456789012";
const legacyOpId = `pickup-${legacyShellDeliveryId}-${crypto.randomUUID()}`;
assert.ok(
  legacyOpId.length > MAX_LEN,
  "fixture: legacy op id should exceed CF max",
);

const resolved = resolvePickupClientOperationId(legacyOpId);
assert.ok(resolved.length <= MAX_LEN, `resolved length ${resolved.length}`);
assert.ok(PATTERN.test(resolved), `resolved pattern ${resolved}`);

const fresh = newPickupClientOperationId();
assert.ok(fresh.length <= MAX_LEN && PATTERN.test(fresh), fresh);

assert.equal(resolvePickupClientOperationId("op-willcall-pickup"), "op-willcall-pickup");

console.log("test-pickup-client-op-id — ALL PASS");
