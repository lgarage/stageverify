/**
 * Operator customer onboarding + idempotency + spot isolation.
 * Usage: npm run test:operator-customer-onboarding
 */
import {
  callable,
  createAuthUser,
  createTestClient,
  initAdmin,
  seedOperator,
  signIn,
  addr,
  expectHttpsError,
} from "./lib/operator-test-lib.mjs";

initAdmin();
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

console.log("\n=== operator customer onboarding ===\n");

const client = createTestClient("onboard");
const email = `op-onboard-${stamp}@test.local`;
const uid = await createAuthUser(client.auth, email);
await seedOperator(uid);
await signIn(client.auth, email);

const createCustomer = callable(client.functions, "createCustomerWithOnboarding");
const sharedBilling = addr(" shared");

const opId = `op_onboard_${stamp}`;
const payload = {
  companyName: "Multi Loc Co",
  primaryContactName: "Pat",
  primaryContactEmail: "pat@multi.test",
  primaryContactPhone: "555-0100",
  locations: [
    {
      locationName: "North",
      physicalAddress: addr(" N"),
      billingAddress: sharedBilling,
      billingSameAsPhysical: false,
      billingContactName: "Bill",
      billingEmail: "bill@multi.test",
      billingPhone: "555-0102",
      groundSpotCount: 1,
      shelfSpotCount: 0,
    },
    {
      locationName: "South",
      physicalAddress: addr(" S"),
      billingAddress: sharedBilling,
      billingSameAsPhysical: false,
      billingContactName: "Bill",
      billingEmail: "bill@multi.test",
      billingPhone: "555-0102",
      groundSpotCount: 1,
      shelfSpotCount: 0,
    },
  ],
  users: [
    {
      name: "Dispatcher One",
      email: "disp@multi.test",
      role: "dispatcher",
      locationIndexes: [0, 1],
    },
  ],
  clientOperationId: opId,
};

const first = await createCustomer(payload);
const customerId = first.data.customer.customerId;
if (first.data.locations.length === 2) pass("customer may contain multiple locations");
else fail("customer may contain multiple locations");

const north = first.data.locations.find((l) => l.locationName === "North");
const south = first.data.locations.find((l) => l.locationName === "South");
const northG1 = north?.layout.spots.find((s) => s.visibleLabel === "G1");
const southG1 = south?.layout.spots.find((s) => s.visibleLabel === "G1");
if (northG1 && southG1 && northG1.spotId !== southG1.spotId) {
  pass("Location A G1 and Location B G1 remain distinct");
} else {
  fail("distinct G1 spot identities");
}

if (
  JSON.stringify(north?.billingAddress) === JSON.stringify(south?.billingAddress)
) {
  pass("two locations may share same billing address");
} else {
  fail("shared billing address");
}

const replay = await createCustomer(payload);
if (replay.data.customer.customerId === customerId) {
  pass("duplicate/replayed create returns same customer (idempotent)");
} else {
  fail("idempotent replay");
}

const custCount = (await db.collection("consoleCustomers").get()).size;
const locCount = (await db.collection("consoleLocations").where("customerId", "==", customerId).get()).size;
if (locCount === 2) pass("no orphaned partial tree on replay");
else fail("partial tree on replay", new Error(`locations=${locCount}`));

await expectHttpsError(
  "malformed create rejected (empty company)",
  () => createCustomer({ ...payload, companyName: "  ", clientOperationId: `op_bad_${stamp}` }),
  "invalid-argument",
  pass,
  fail,
);

await expectHttpsError(
  "foreign location assignment rejected",
  () =>
    callable(client.functions, "addUserToCustomer")({
      customerId,
      user: {
        name: "Bad",
        email: "bad@test.local",
        role: "dispatcher",
        locationIds: ["loc_foreign_guess"],
      },
      clientOperationId: `op_foreign_${stamp}`,
    }),
  "invalid-argument",
  pass,
  fail,
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
