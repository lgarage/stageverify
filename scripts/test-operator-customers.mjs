/**
 * Unit tests for operator customer/location foundation (local store).
 * Usage: npm run test:operator-customers
 */
import assert from "node:assert/strict";
import {
  assertSpotIdentityIsolation,
  createCustomerWithOnboarding,
  getCustomerBundle,
  listCustomersWithSummary,
  loadOperatorStore,
  resetOperatorStoreForTests,
  setOperatorStorageAdapter,
  transitionLocationOnboarding,
} from "../src/operator/operatorStore.ts";
import {
  canTransitionOnboarding,
  transitionOnboarding,
} from "../src/operator/onboardingTransitions.ts";

const memory = new Map();
setOperatorStorageAdapter({
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
});

let passed = 0;
let failed = 0;

function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

function addr(suffix = "") {
  return {
    line1: `100 Main St${suffix}`,
    line2: "",
    city: "Springfield",
    region: "IL",
    postalCode: "62701",
    country: "US",
  };
}

try {
  resetOperatorStoreForTests();
  memory.clear();
  setOperatorStorageAdapter({
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  });

  const one = createCustomerWithOnboarding({
    companyName: "Acme One",
    primaryContactName: "Pat",
    primaryContactEmail: "pat@acme.test",
    primaryContactPhone: "555-0100",
    locations: [
      {
        locationName: "HQ",
        physicalAddress: addr(),
        billingSameAsPhysical: true,
        billingContactName: "Billing Pat",
        billingEmail: "billing@acme.test",
        billingPhone: "555-0101",
        groundSpotCount: 2,
        shelfSpotCount: 1,
      },
    ],
  });
  assert.equal(one.locations.length, 1);
  assert.equal(one.locations[0].layout.spots.length, 3);
  assert.equal(listCustomersWithSummary().length, 1);
  pass("1) one customer with one location");
} catch (err) {
  fail("1) one customer with one location", err);
}

try {
  resetOperatorStoreForTests();
  memory.clear();

  const twoLoc = createCustomerWithOnboarding({
    companyName: "Dual Sites LLC",
    primaryContactName: "Alex",
    primaryContactEmail: "alex@dual.test",
    primaryContactPhone: "555-0200",
    locations: [
      {
        locationName: "East",
        physicalAddress: addr(" E"),
        billingSameAsPhysical: true,
        billingContactName: "East Billing",
        billingEmail: "east@dual.test",
        billingPhone: "555-0201",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
      {
        locationName: "West",
        physicalAddress: addr(" W"),
        billingSameAsPhysical: true,
        billingContactName: "West Billing",
        billingEmail: "west@dual.test",
        billingPhone: "555-0202",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
    ],
  });
  assert.equal(twoLoc.locations.length, 2);
  pass("2) one customer with two locations");
} catch (err) {
  fail("2) one customer with two locations", err);
}

try {
  resetOperatorStoreForTests();
  memory.clear();

  const sharedBilling = addr(" shared");
  const multi = createCustomerWithOnboarding({
    companyName: "Shared Billing Co",
    primaryContactName: "Sam",
    primaryContactEmail: "sam@shared.test",
    primaryContactPhone: "555-0300",
    locations: [
      {
        locationName: "A",
        physicalAddress: addr(" A"),
        billingSameAsPhysical: false,
        billingAddress: sharedBilling,
        billingContactName: "Bill A",
        billingEmail: "a@shared.test",
        billingPhone: "555-0301",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
      {
        locationName: "B",
        physicalAddress: addr(" B"),
        billingSameAsPhysical: false,
        billingAddress: { ...sharedBilling },
        billingContactName: "Bill B",
        billingEmail: "b@shared.test",
        billingPhone: "555-0302",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
    ],
  });
  const bA = multi.locations[0].billingAddress;
  const bB = multi.locations[1].billingAddress;
  assert.deepEqual(bA, bB);
  assert.notEqual(bA, bB);
  pass("3) identical billing address copies across two locations");
} catch (err) {
  fail("3) identical billing address copies across two locations", err);
}

try {
  resetOperatorStoreForTests();
  memory.clear();

  const g1 = createCustomerWithOnboarding({
    companyName: "G1 Label Co",
    primaryContactName: "G",
    primaryContactEmail: "g@g1.test",
    primaryContactPhone: "555-0400",
    locations: [
      {
        locationName: "Loc 1",
        physicalAddress: addr("1"),
        billingSameAsPhysical: true,
        billingContactName: "B1",
        billingEmail: "b1@g1.test",
        billingPhone: "555-0401",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
      {
        locationName: "Loc 2",
        physicalAddress: addr("2"),
        billingSameAsPhysical: true,
        billingContactName: "B2",
        billingEmail: "b2@g1.test",
        billingPhone: "555-0402",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
    ],
  });
  const spot1 = g1.locations[0].layout.spots.find((s) => s.visibleLabel === "G1");
  const spot2 = g1.locations[1].layout.spots.find((s) => s.visibleLabel === "G1");
  assert.ok(spot1 && spot2);
  assert.notEqual(spot1.spotId, spot2.spotId);
  assert.notEqual(spot1.locationId, spot2.locationId);
  assertSpotIdentityIsolation(loadOperatorStore(), "G1");
  pass("4) same visible label G1 at two locations — unique spotId per scope");
} catch (err) {
  fail("4) same visible label G1 at two locations — unique spotId per scope", err);
}

try {
  resetOperatorStoreForTests();
  memory.clear();

  const usersBundle = createCustomerWithOnboarding({
    companyName: "User Mix Co",
    primaryContactName: "U",
    primaryContactEmail: "u@mix.test",
    primaryContactPhone: "555-0500",
    locations: [
      {
        locationName: "North",
        physicalAddress: addr(" N"),
        billingSameAsPhysical: true,
        billingContactName: "BN",
        billingEmail: "bn@mix.test",
        billingPhone: "555-0501",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
      {
        locationName: "South",
        physicalAddress: addr(" S"),
        billingSameAsPhysical: true,
        billingContactName: "BS",
        billingEmail: "bs@mix.test",
        billingPhone: "555-0502",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
    ],
    users: [
      {
        name: "North Only",
        email: "north@mix.test",
        role: "dispatcher",
        locationIndexes: [0],
      },
      {
        name: "Both Sites",
        email: "both@mix.test",
        role: "manager",
        locationIndexes: [0, 1],
      },
      {
        name: "South Only",
        email: "south@mix.test",
        role: "technician",
        locationIndexes: [1],
      },
    ],
  });
  assert.equal(usersBundle.users.length, 3);
  assert.equal(usersBundle.users[0].locationIds.length, 1);
  assert.equal(usersBundle.users[1].locationIds.length, 2);
  assert.equal(usersBundle.users[2].locationIds.length, 1);
  pass("5) multiple users with different location assignments");
} catch (err) {
  fail("5) multiple users with different location assignments", err);
}

try {
  resetOperatorStoreForTests();
  memory.clear();

  const bundle = createCustomerWithOnboarding({
    companyName: "Transition Co",
    primaryContactName: "T",
    primaryContactEmail: "t@trans.test",
    primaryContactPhone: "555-0600",
    locations: [
      {
        locationName: "Main",
        physicalAddress: addr(),
        billingSameAsPhysical: true,
        billingContactName: "BT",
        billingEmail: "bt@trans.test",
        billingPhone: "555-0601",
        groundSpotCount: 1,
        shelfSpotCount: 0,
      },
    ],
  });
  const locId = bundle.locations[0].locationId;

  assert.equal(canTransitionOnboarding("NEW", "CONFIGURING"), true);
  assert.equal(canTransitionOnboarding("NEW", "ACTIVE"), false);
  assert.equal(canTransitionOnboarding("NEW", "NEW"), false);

  let loc = transitionLocationOnboarding(locId, "CONFIGURING");
  assert.equal(loc.onboardingStatus, "CONFIGURING");

  loc = transitionLocationOnboarding(locId, "LAYOUT_DRAFT");
  loc = transitionLocationOnboarding(locId, "LAYOUT_APPROVED");
  loc = transitionLocationOnboarding(locId, "SIGNS_ORDERED");
  loc = transitionLocationOnboarding(locId, "READY_TO_INSTALL");
  loc = transitionLocationOnboarding(locId, "INSTALLING");
  loc = transitionLocationOnboarding(locId, "ACTIVE");
  assert.equal(loc.onboardingStatus, "ACTIVE");
  assert.equal(loc.locationStatus, "active");
  assert.ok(loc.activationDate);

  loc = transitionLocationOnboarding(locId, "PAST_DUE");
  assert.equal(loc.locationStatus, "active");

  loc = transitionLocationOnboarding(locId, "SUSPENDED");
  assert.equal(loc.locationStatus, "suspended");

  loc = transitionLocationOnboarding(locId, "CANCELED");
  assert.equal(loc.locationStatus, "canceled");

  let threw = false;
  try {
    transitionLocationOnboarding(locId, "ACTIVE");
  } catch {
    threw = true;
  }
  assert.equal(threw, true);

  const fresh = createCustomerWithOnboarding({
    companyName: "Cancel Terminal",
    primaryContactName: "C",
    primaryContactEmail: "c@cancel.test",
    primaryContactPhone: "555-0700",
    locations: [
      {
        locationName: "X",
        physicalAddress: addr(),
        billingSameAsPhysical: true,
        billingContactName: "BX",
        billingEmail: "bx@cancel.test",
        billingPhone: "555-0701",
        groundSpotCount: 0,
        shelfSpotCount: 0,
      },
    ],
  });
  const cancelId = fresh.locations[0].locationId;
  transitionLocationOnboarding(cancelId, "CONFIGURING");
  transitionLocationOnboarding(cancelId, "LAYOUT_DRAFT");
  transitionLocationOnboarding(cancelId, "LAYOUT_APPROVED");
  transitionLocationOnboarding(cancelId, "SIGNS_ORDERED");
  transitionLocationOnboarding(cancelId, "READY_TO_INSTALL");
  transitionLocationOnboarding(cancelId, "INSTALLING");
  transitionLocationOnboarding(cancelId, "ACTIVE");
  transitionLocationOnboarding(cancelId, "CANCELED");

  const reloadedCancel = getCustomerBundle(fresh.customer.customerId);
  assert.ok(reloadedCancel);
  assert.throws(() =>
    transitionOnboarding(reloadedCancel.locations[0], "ACTIVE", new Date().toISOString()),
  );

  assert.ok(reloadedCancel);
  pass("6) onboarding transitions allowed, rejected illegal, CANCELED terminal");
} catch (err) {
  fail("6) onboarding transitions allowed, rejected illegal, CANCELED terminal", err);
}

console.log(`\ntest:operator-customers — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
