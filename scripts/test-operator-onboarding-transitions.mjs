/**
 * Onboarding transitions — pure logic + illegal callable transition.
 * Usage: npm run test:operator-onboarding-transitions
 */
import {
  canTransitionOnboarding,
  transitionOnboarding,
} from "../functions/src/operatorConsole/onboardingTransitions.ts";
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

console.log("\n=== operator onboarding transitions ===\n");

if (canTransitionOnboarding("NEW", "CONFIGURING")) pass("NEW → CONFIGURING allowed");
else fail("NEW → CONFIGURING allowed");

if (!canTransitionOnboarding("NEW", "ACTIVE")) pass("NEW → ACTIVE blocked in pure logic");
else fail("NEW → ACTIVE blocked");

try {
  transitionOnboarding(
    {
      locationId: "loc_test",
      customerId: "cus_test",
      locationName: "X",
      physicalAddress: {
        line1: "1",
        city: "c",
        region: "r",
        postalCode: "1",
        country: "US",
      },
      billingAddress: {
        line1: "1",
        city: "c",
        region: "r",
        postalCode: "1",
        country: "US",
      },
      billingSameAsPhysical: true,
      billingContactName: "",
      billingEmail: "",
      billingPhone: "",
      onboardingStatus: "NEW",
      locationStatus: "active",
      spotAllowance: 30,
      foundingPrice: true,
      monthlyPriceUsd: 199,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      layout: { customerId: "cus_test", locationId: "loc_test", spots: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    "ACTIVE",
    new Date().toISOString(),
  );
  fail("pure transitionOnboarding throws on illegal jump");
} catch {
  pass("pure transitionOnboarding throws on illegal jump");
}

initAdmin();
const stamp = Date.now();
const client = createTestClient("transition");
const uid = await createAuthUser(client.auth, `op-trans-${stamp}@test.local`);
await seedOperator(uid);
await signIn(client.auth, `op-trans-${stamp}@test.local`);

const created = await callable(client.functions, "createCustomerWithOnboarding")(
  sampleCreatePayload("Transition Co"),
);
const locationId = created.data.locations[0].locationId;

await expectHttpsError(
  "callable illegal transition NEW → ACTIVE",
  () =>
    callable(client.functions, "transitionLocationOnboarding")({
      locationId,
      to: "ACTIVE",
      clientOperationId: `op_bad_trans_${stamp}`,
    }),
  "failed-precondition",
  pass,
  fail,
);

const advanced = await callable(client.functions, "transitionLocationOnboarding")({
  locationId,
  to: "CONFIGURING",
  clientOperationId: `op_good_trans_${stamp}`,
});
if (advanced.data.onboardingStatus === "CONFIGURING") {
  pass("legal transition NEW → CONFIGURING via callable");
} else {
  fail("legal transition via callable");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
