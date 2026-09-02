/**
 * Activity audit — actorUid stamped server-side on mutations.
 * Usage: npm run test:operator-activity-audit
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

const db = initAdmin();
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

console.log("\n=== operator activity audit ===\n");

const client = createTestClient("audit");
const email = `op-audit-${stamp}@test.local`;
const uid = await createAuthUser(client.auth, email);
await seedOperator(uid);
await signIn(client.auth, email);

const created = await callable(client.functions, "createCustomerWithOnboarding")({
  ...sampleCreatePayload("Audit Co"),
  clientOperationId: `op_audit_${stamp}`,
});

const events = await db
  .collection("consoleActivityEvents")
  .where("customerId", "==", created.data.customer.customerId)
  .get();

if (events.size >= 1) pass("customer.created activity persisted");
else fail("activity persisted");

const evt = events.docs[0].data();
if (evt.actorUid === uid) pass("actorUid matches authenticated operator");
else fail("actorUid matches operator", new Error(`got ${evt.actorUid}`));

if (!("clientActorUid" in evt)) pass("client actor fields not stored");
else fail("client actor fields not stored");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
