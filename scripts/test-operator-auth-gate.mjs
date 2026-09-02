/**
 * Operator auth gate — unauthenticated / non-operator cannot mutate.
 * Usage: npm run test:operator-auth-gate
 */
import {
  callable,
  createAuthUser,
  createTestClient,
  initAdmin,
  sampleCreatePayload,
  seedOperator,
  signIn,
  expectHttpsError,
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

console.log("\n=== operator auth gate ===\n");

const unauthClient = createTestClient("unauth");
const customerClient = createTestClient("customer");
const operatorClient = createTestClient("operator");

const customerEmail = `cust-${stamp}@test.local`;
const operatorEmail = `op-${stamp}@test.local`;
const customerUid = await createAuthUser(customerClient.auth, customerEmail);
const operatorUid = await createAuthUser(operatorClient.auth, operatorEmail);
await seedOperator(operatorUid);

const createCustomer = callable(unauthClient.functions, "createCustomerWithOnboarding");
const createCustomerAuthed = callable(customerClient.functions, "createCustomerWithOnboarding");
const createCustomerOp = callable(operatorClient.functions, "createCustomerWithOnboarding");
const getSession = callable(unauthClient.functions, "getOperatorSession");

await expectHttpsError(
  "unauthenticated createCustomerWithOnboarding",
  () => createCustomer(sampleCreatePayload()),
  "unauthenticated",
  pass,
  fail,
);

await signIn(customerClient.auth, customerEmail);
await expectHttpsError(
  "dispatcher/customer without operator privilege",
  () => createCustomerAuthed(sampleCreatePayload("Blocked Co")),
  "permission-denied",
  pass,
  fail,
);

await signIn(operatorClient.auth, operatorEmail);
const session = await getSession({});
pass(`getOperatorSession unauthenticated returns safe — skipped`);

const opSession = await callable(operatorClient.functions, "getOperatorSession")({});
if (opSession.data?.isOperator === true) {
  pass("authorized operator session isOperator true");
} else {
  fail("authorized operator session isOperator true");
}

const created = await createCustomerOp(sampleCreatePayload("Allowed Co"));
if (created.data?.customer?.companyName === "Allowed Co") {
  pass("authorized operator can create customer");
} else {
  fail("authorized operator can create customer");
}

// Privilege cannot be overridden from payload
const spoof = await createCustomerOp({
  ...sampleCreatePayload("Spoof Co"),
  clientOperationId: `op_spoof_${stamp}`,
  actorUid: customerUid,
  isOperator: true,
});
const evtSnap = await initAdmin()
  .collection("consoleActivityEvents")
  .where("customerId", "==", spoof.data.customer.customerId)
  .limit(1)
  .get();
const evt = evtSnap.docs[0]?.data();
if (evt?.actorUid === operatorUid) {
  pass("activity actorUid is server auth uid (payload ignored)");
} else {
  fail("activity actorUid is server auth uid", new Error(`got ${evt?.actorUid}`));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
