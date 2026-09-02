/**
 * Tenant isolation — customer A cannot reference customer B locations.
 * Usage: npm run test:operator-tenant-isolation
 */
import {
  callable,
  createAuthUser,
  createTestClient,
  initAdmin,
  sampleCreatePayload,
  seedOperator,
  signIn,
} from "./lib/operator-test-lib.mjs";

initAdmin();
const stamp = Date.now();
let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, err) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
};

console.log("\n=== operator tenant isolation ===\n");

const client = createTestClient("tenant");
const uid = await createAuthUser(client.auth, `op-tenant-${stamp}@test.local`);
await seedOperator(uid);
await signIn(client.auth, `op-tenant-${stamp}@test.local`);

const createCustomer = callable(client.functions, "createCustomerWithOnboarding");
const a = await createCustomer({
  ...sampleCreatePayload("Tenant A"),
  clientOperationId: `op_a_${stamp}`,
});
const b = await createCustomer({
  ...sampleCreatePayload("Tenant B"),
  clientOperationId: `op_b_${stamp}`,
});
const foreignLocId = b.data.locations[0].locationId;

try {
  await callable(client.functions, "addUserToCustomer")({
    customerId: a.data.customer.customerId,
    user: {
      name: "Cross",
      email: "cross@test.local",
      role: "dispatcher",
      locationIds: [foreignLocId],
    },
    clientOperationId: `op_cross_${stamp}`,
  });
  fail("assignment to another customer's location rejected");
} catch (err) {
  if (String(err?.code).includes("invalid-argument")) {
    pass("assignment to another customer's location rejected");
  } else {
    fail("assignment rejected with invalid-argument", err);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
