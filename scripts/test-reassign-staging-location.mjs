/**
 * Emulator tests for reassignDeliveryStagingLocation CF (Change Location).
 * Usage: npm run test:reassign-staging-location
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const DISPATCHER_EMAIL = "reassign-staging-dispatcher@test.local";
const PASSWORD = "StageVerifyTest1!";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

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

function codeOf(err) {
  return String(err?.code ?? "");
}

function msgOf(err) {
  return String(err?.message ?? "");
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig, "reassign-staging-client");
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const reassign = httpsCallable(functions, "reassignDeliveryStagingLocation");

async function seed(setup) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setup(ctx.firestore());
  });
}

async function readDelivery(id) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", id));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

async function seedLocation(db, id, code, status = "Active") {
  await setDoc(doc(db, "stagingLocations", id), {
    id,
    code,
    label: `Bay ${code}`,
    type: "ground",
    status,
    active: status === "Active",
  });
}

async function seedDelivery(db, id, extra = {}) {
  await setDoc(doc(db, "deliveries", id), {
    id,
    orderNumber: `ORD-${id}`,
    jobId: "job-reassign",
    vendorId: "vendor-reassign",
    status: "arrived",
    invoiceFulfillmentMethod: "delivery",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
}

console.log("\n=== reassignDeliveryStagingLocation CF ===\n");

let dispatcherUid;
try {
  const cred = await createUserWithEmailAndPassword(
    auth,
    DISPATCHER_EMAIL,
    PASSWORD,
  );
  dispatcherUid = cred.user.uid;
} catch {
  await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);
  dispatcherUid = auth.currentUser.uid;
}

await seed(async (db) => {
  await setDoc(doc(db, "dispatcherRoles", dispatcherUid), {
    active: true,
    updatedAt: "2026-08-01T00:00:00Z",
  });
  await seedLocation(db, "loc-g9", "G9");
  await seedLocation(db, "loc-g7", "G7");
  await seedLocation(db, "loc-g8", "G8");
  await seedLocation(db, "loc-g6", "G6");
  await seedLocation(db, "loc-g5", "G5");
  await seedLocation(db, "loc-g4", "G4");
  await seedLocation(db, "loc-g15", "G15");
  await seedLocation(db, "loc-planned-only", "P1");
  await seedLocation(db, "loc-inactive", "Z9", "Planned");
});

await signOut(auth);
try {
  await reassign({ deliveryId: "del-x", newLocationId: "loc-g7" });
  fail("unauthenticated should reject");
} catch (err) {
  if (codeOf(err).includes("permission-denied") || /sign in/i.test(msgOf(err))) {
    pass("unauthenticated rejected");
  } else {
    fail("unauthenticated rejected", err);
  }
}

await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);

// Happy path: actual G9 → G7
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-happy", {
    stagingLocationId: "loc-g9",
    plannedStagingLocationIds: ["loc-g9"],
  });
});
try {
  const result = await reassign({
    deliveryId: "del-reassign-happy",
    newLocationId: "loc-g7",
  });
  const d = result.data;
  const after = await readDelivery("del-reassign-happy");
  if (
    d?.ok === true &&
    after?.stagingLocationId === "loc-g7" &&
    Array.isArray(after?.additionalStagingLocationIds) &&
    after.additionalStagingLocationIds.length === 0 &&
    Array.isArray(after?.plannedStagingLocationIds) &&
    after.plannedStagingLocationIds.length === 0 &&
    Array.isArray(after?.plannedLocationReleases) &&
    after.plannedLocationReleases.some((e) => e.locationId === "loc-g9")
  ) {
    pass("happy path actual+planned G9 → G7 releases old");
  } else {
    fail("happy path actual+planned G9 → G7", JSON.stringify({ d, after }));
  }
} catch (err) {
  fail("happy path actual+planned G9 → G7", err);
}

// Multi-spot collapse
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-multi", {
    stagingLocationId: "loc-g9",
    additionalStagingLocationIds: ["loc-g15"],
    plannedStagingLocationIds: ["loc-g9", "loc-g15"],
  });
});
try {
  const result = await reassign({
    deliveryId: "del-reassign-multi",
    newLocationId: "loc-g8",
  });
  const after = await readDelivery("del-reassign-multi");
  if (
    result.data?.ok &&
    after?.stagingLocationId === "loc-g8" &&
    (after.additionalStagingLocationIds ?? []).length === 0 &&
    (after.plannedStagingLocationIds ?? []).length === 0
  ) {
    pass("multi-spot collapses to single new primary");
  } else {
    fail("multi-spot collapse", JSON.stringify(after));
  }
} catch (err) {
  fail("multi-spot collapse", err);
}

// Planned-only → promote
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-planned-only", {
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-g9"],
  });
});
try {
  const result = await reassign({
    deliveryId: "del-reassign-planned-only",
    newLocationId: "loc-g6",
  });
  const after = await readDelivery("del-reassign-planned-only");
  if (
    result.data?.ok &&
    after?.stagingLocationId === "loc-g6" &&
    (after.plannedStagingLocationIds ?? []).length === 0 &&
    (after.plannedLocationReleases ?? []).some((e) => e.locationId === "loc-g9")
  ) {
    pass("planned-only G9 → G6 promotes + clears planned");
  } else {
    fail("planned-only promote", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("planned-only promote", err);
}

// Promote same planned code (not no-op)
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-promote-same", {
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-g5"],
  });
});
try {
  const result = await reassign({
    deliveryId: "del-reassign-promote-same",
    newLocationId: "loc-g5",
  });
  const after = await readDelivery("del-reassign-promote-same");
  if (
    result.data?.ok &&
    !result.data?.unchanged &&
    after?.stagingLocationId === "loc-g5" &&
    (after.plannedStagingLocationIds ?? []).length === 0
  ) {
    pass("planned-only confirm same code promotes (not unchanged)");
  } else {
    fail("planned-only same-code promote", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("planned-only same-code promote", err);
}

// Target already in planned — audit excludes promoted id
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-promote-target", {
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-g4", "loc-g15"],
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-promote-target",
    newLocationId: "loc-g4",
  });
  const after = await readDelivery("del-reassign-promote-target");
  const releases = after?.plannedLocationReleases ?? [];
  const releasedIds = releases.map((e) => e.locationId);
  if (
    after?.stagingLocationId === "loc-g4" &&
    releasedIds.includes("loc-g15") &&
    !releasedIds.includes("loc-g4")
  ) {
    pass("promote target excludes G4 from plannedLocationReleases audit");
  } else {
    fail("promote target audit exclusion", JSON.stringify(after));
  }
} catch (err) {
  fail("promote target audit exclusion", err);
}

// True no-op
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-noop", {
    stagingLocationId: "loc-g7",
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: [],
  });
});
try {
  const before = await readDelivery("del-reassign-noop");
  const result = await reassign({
    deliveryId: "del-reassign-noop",
    newLocationId: "loc-g7",
  });
  const after = await readDelivery("del-reassign-noop");
  if (
    result.data?.unchanged === true &&
    after?.updatedAt === before?.updatedAt &&
    (after?.plannedLocationReleases ?? []).length ===
      (before?.plannedLocationReleases ?? []).length
  ) {
    pass("true no-op unchanged + no write");
  } else {
    fail("true no-op", JSON.stringify({ d: result.data, before, after }));
  }
} catch (err) {
  fail("true no-op", err);
}

// Occupied via primary
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-src-primary", {
    stagingLocationId: "loc-g9",
  });
  await seedDelivery(db, "del-reassign-other-primary", {
    stagingLocationId: "loc-g7",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-src-primary",
    newLocationId: "loc-g7",
  });
  fail("occupied via stagingLocationId should reject");
} catch (err) {
  const after = await readDelivery("del-reassign-src-primary");
  if (
    /no longer available/i.test(msgOf(err)) &&
    after?.stagingLocationId === "loc-g9"
  ) {
    pass("occupied via stagingLocationId — keep G9");
  } else {
    fail("occupied via stagingLocationId", err);
  }
}

// Occupied via additional
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-src-addl", {
    stagingLocationId: "loc-g9",
  });
  await seedDelivery(db, "del-reassign-other-addl", {
    stagingLocationId: "loc-planned-only",
    additionalStagingLocationIds: ["loc-g7"],
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-src-addl",
    newLocationId: "loc-g7",
  });
  fail("occupied via additional should reject");
} catch (err) {
  const after = await readDelivery("del-reassign-src-addl");
  if (
    /no longer available/i.test(msgOf(err)) &&
    after?.stagingLocationId === "loc-g9"
  ) {
    pass("occupied via additionalStagingLocationIds — keep G9");
  } else {
    fail("occupied via additional", err);
  }
}

// Occupied via planned-only on other delivery
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-src-planned-occ", {
    stagingLocationId: "loc-g9",
  });
  await seedDelivery(db, "del-reassign-other-planned-occ", {
    stagingLocationId: "",
    plannedStagingLocationIds: ["loc-g7"],
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-src-planned-occ",
    newLocationId: "loc-g7",
  });
  fail("occupied via planned should reject");
} catch (err) {
  const after = await readDelivery("del-reassign-src-planned-occ");
  if (
    /no longer available/i.test(msgOf(err)) &&
    after?.stagingLocationId === "loc-g9"
  ) {
    pass("occupied via plannedStagingLocationIds — keep G9");
  } else {
    fail("occupied via planned", err);
  }
}

// Will-Call reject
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-willcall", {
    stagingLocationId: "loc-g9",
    invoiceFulfillmentMethod: "will_call_pickup",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-willcall",
    newLocationId: "loc-g7",
  });
  fail("Will-Call should reject");
} catch (err) {
  if (codeOf(err).includes("failed-precondition") || /Will-Call/i.test(msgOf(err))) {
    pass("Will-Call rejected");
  } else {
    fail("Will-Call rejected", err);
  }
}

// picked_up reject
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-picked", {
    stagingLocationId: "loc-g9",
    status: "picked_up",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-picked",
    newLocationId: "loc-g7",
  });
  fail("picked_up should reject");
} catch (err) {
  if (codeOf(err).includes("failed-precondition")) {
    pass("picked_up rejected");
  } else {
    fail("picked_up rejected", err);
  }
}

// empty staging reject
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-empty", {
    stagingLocationId: "",
    plannedStagingLocationIds: [],
    additionalStagingLocationIds: [],
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-empty",
    newLocationId: "loc-g7",
  });
  fail("empty staging should reject");
} catch (err) {
  if (/Assign Location/i.test(msgOf(err))) {
    pass("empty staging → use Assign Location");
  } else {
    fail("empty staging", err);
  }
}

// inactive destination
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-inactive-dest", {
    stagingLocationId: "loc-g9",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-inactive-dest",
    newLocationId: "loc-inactive",
  });
  fail("inactive destination should reject");
} catch (err) {
  if (/no longer available/i.test(msgOf(err))) {
    pass("inactive destination rejected");
  } else {
    fail("inactive destination", err);
  }
}

// missing destination
try {
  await reassign({
    deliveryId: "del-reassign-happy",
    newLocationId: "loc-missing-xyz",
  });
  fail("missing destination should reject");
} catch (err) {
  if (codeOf(err).includes("not-found") || /not found/i.test(msgOf(err))) {
    pass("missing destination not-found");
  } else {
    fail("missing destination", err);
  }
}

// installed reject
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-installed", {
    stagingLocationId: "loc-g9",
    status: "installed",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-installed",
    newLocationId: "loc-g8",
  });
  fail("installed should reject");
} catch (err) {
  if (codeOf(err).includes("failed-precondition")) {
    pass("installed rejected");
  } else {
    fail("installed rejected", err);
  }
}

// Cleared occupant ignored — destination free
await seed(async (db) => {
  await seedDelivery(db, "del-reassign-cleared-occ", {
    stagingLocationId: "loc-g9",
  });
  await seedDelivery(db, "del-reassign-picked-on-g3", {
    stagingLocationId: "loc-g3",
    status: "picked_up",
  });
  await seedLocation(db, "loc-g3", "G3");
});
try {
  const result = await reassign({
    deliveryId: "del-reassign-cleared-occ",
    newLocationId: "loc-g3",
  });
  const after = await readDelivery("del-reassign-cleared-occ");
  if (result.data?.ok && after?.stagingLocationId === "loc-g3") {
    pass("cleared/picked_up occupant ignored — destination available");
  } else {
    fail("cleared occupant ignored", JSON.stringify({ d: result.data, after }));
  }
} catch (err) {
  fail("cleared occupant ignored", err);
}

// Active occupant behind many cleared docs (paging)
await seed(async (db) => {
  await seedLocation(db, "loc-g2", "G2");
  await seedDelivery(db, "del-reassign-page-src", {
    stagingLocationId: "loc-g9",
  });
  for (let i = 0; i < 22; i += 1) {
    await seedDelivery(db, `del-reassign-cleared-page-${i}`, {
      stagingLocationId: "loc-g2",
      status: "picked_up",
    });
  }
  await seedDelivery(db, "del-reassign-active-behind-page", {
    stagingLocationId: "loc-g2",
    status: "arrived",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-page-src",
    newLocationId: "loc-g2",
  });
  fail("active occupant behind cleared page should reject");
} catch (err) {
  const after = await readDelivery("del-reassign-page-src");
  if (
    /no longer available/i.test(msgOf(err)) &&
    after?.stagingLocationId === "loc-g9"
  ) {
    pass("active occupant behind cleared docs — reject + keep G9");
  } else {
    fail("active occupant behind cleared page", err);
  }
}

// Non-dispatcher authenticated reject
await seed(async (db) => {
  await setDoc(doc(db, "dispatcherRoles", dispatcherUid), {
    active: false,
    updatedAt: "2026-08-01T00:00:00Z",
  });
  await seedDelivery(db, "del-reassign-no-role", {
    stagingLocationId: "loc-g9",
  });
});
try {
  await reassign({
    deliveryId: "del-reassign-no-role",
    newLocationId: "loc-g8",
  });
  fail("inactive dispatcher role should reject");
} catch (err) {
  if (codeOf(err).includes("permission-denied") || /Dispatcher/i.test(msgOf(err))) {
    pass("inactive dispatcher role rejected");
  } else {
    fail("inactive dispatcher role", err);
  }
} finally {
  await seed(async (db) => {
    await setDoc(doc(db, "dispatcherRoles", dispatcherUid), {
      active: true,
      updatedAt: "2026-08-01T00:00:00Z",
    });
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
await testEnv.cleanup();
if (failed > 0) process.exit(1);
