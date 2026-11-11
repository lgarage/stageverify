/**
 * Jobless unplanned walk-in pickup + clear (Firestore + Functions + Auth emulators).
 * Usage: npm run test:unplanned-willcall-pickup
 */

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const DISPATCHER_TEST_EMAIL = "unplanned-willcall-dispatcher@stageverify.test";
const DISPATCHER_TEST_PASSWORD = "StageVerifyTest1!";
const NON_DISPATCHER_EMAIL = "unplanned-willcall-nodispatcher@stageverify.test";
const NON_DISPATCHER_PASSWORD = "StageVerifyTest1!";

const TEST_PICKUP_TOKEN = "b".repeat(64);
const TEST_PICKUP_TOKEN_HASH = createHash("sha256")
  .update(TEST_PICKUP_TOKEN)
  .digest("hex");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig);
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const recordPickup = httpsCallable(functions, "recordPickupEvent");
const clearStaged = httpsCallable(functions, "clearStagedDelivery");

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

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

async function queryWhere(colName, field, value) {
  let rows = [];
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(
      query(collection(ctx.firestore(), colName), where(field, "==", value)),
    );
    rows = snap.docs.map((d) => d.data());
  });
  return rows;
}

async function seedDispatcherRole(uid, { active = true, fullName = "Pat Dispatcher" } = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, "dispatcherRoles", uid), {
      active,
      role: "dispatcher",
      fullName,
      email: DISPATCHER_TEST_EMAIL,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
}

async function ensureAuthUser(email, password) {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch {
    // already exists in this emulator run
  }
  await signInWithEmailAndPassword(auth, email, password);
  return auth.currentUser.uid;
}

async function seedUnplannedStaged(db, {
  id,
  locId = "unplanned-willcall-pickup_loc-a",
  status = "pending",
} = {}) {
  await setDoc(doc(db, "stagingLocations", locId), {
    id: locId,
    code: "S1L",
    type: "shelf",
    active: true,
    sortOrder: 1,
  });
  await setDoc(doc(db, "deliveries", id), {
    id,
    orderNumber: `UNPL-${id.slice(-6)}`,
    vendorId: "vendor-unplanned-willcall",
    vendorName: "Walk-In Vendor",
    deliveryDate: "2026-11-11",
    status,
    unplanned: true,
    unplannedSubmittedReference: "WALK-IN-1",
    unplannedCreatedVia: "vendor_pin_fallback",
    stagingLocationId: locId,
    additionalStagingLocationIds: [],
    plannedStagingLocationIds: [],
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
  });
}

async function seedJobLinkedReady(db, id) {
  const jobId = `${id}-job`;
  await setDoc(doc(db, "jobs", jobId), {
    id: jobId,
    jobNumber: "26-2001",
    jobName: "Linked Job",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "deliveries", id), {
    id,
    orderNumber: "ORD-LINKED",
    jobId,
    vendorId: "vendor-1",
    deliveryDate: "2026-06-12",
    status: "ready_for_pickup",
    readinessStatus: "ready_for_pickup",
    vendorOrderComplete: true,
    physicalDropoffComplete: true,
    stagingAssignmentComplete: true,
    stagingLocationId: "unplanned-willcall-pickup_loc-linked",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "stagingLocations", "unplanned-willcall-pickup_loc-linked"), {
    id: "unplanned-willcall-pickup_loc-linked",
    code: "G2",
    type: "ground",
    active: true,
  });
  await setDoc(doc(db, "items", `${id}-item`), {
    id: `${id}-item`,
    deliveryOrderId: id,
    description: "Linked coil",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  });
  await setDoc(doc(db, "pickupTokens", TEST_PICKUP_TOKEN_HASH), {
    id: TEST_PICKUP_TOKEN_HASH,
    jobId,
    tokenHash: TEST_PICKUP_TOKEN_HASH,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revokedAt: null,
    createdBy: "test",
    createdAt: "2026-01-01T00:00:00Z",
  });
}

console.log("\n=== Jobless unplanned will-call pickup / clear ===\n");

try {
  await seed(async (db) => {
    await setDoc(doc(db, "appSettings", "config"), {
      vendorDeliveryMode: "full_checkin",
    });
  });

  // 1. Unplanned delivery without job or items can be staged.
  const stagedId = "unplanned-willcall-pickup_del-staged";
  await seed(async (db) => {
    await seedUnplannedStaged(db, { id: stagedId });
  });
  const staged = await readDelivery(stagedId);
  if (
    staged?.unplanned === true &&
    !staged.jobId &&
    staged.stagingLocationId === "unplanned-willcall-pickup_loc-a" &&
    staged.status === "pending"
  ) {
    pass("unplanned delivery without job/items can hold a staging location");
  } else {
    fail("unplanned staging seed", new Error(JSON.stringify(staged)));
  }

  const dispatcherUid = await ensureAuthUser(
    DISPATCHER_TEST_EMAIL,
    DISPATCHER_TEST_PASSWORD,
  );
  await seedDispatcherRole(dispatcherUid);

  // 2–4. Authorized dispatcher completes pickup; history + staging released.
  const pickupId = "unplanned-willcall-pickup_del-pickup";
  await seed(async (db) => {
    await seedUnplannedStaged(db, {
      id: pickupId,
      locId: "unplanned-willcall-pickup_loc-pickup",
    });
  });
  const pickupOp = "op-unplanned-pickup-1";
  const pickupResult = await recordPickup({
    deliveryOrderId: pickupId,
    technicianName: "Alex Recipient",
    itemsPickedSummary: "2 boxes of fittings",
    clientOperationId: pickupOp,
  });
  if (
    pickupResult.data.duplicate === false &&
    pickupResult.data.deliveryStatus === "picked_up"
  ) {
    pass("authorized dispatcher can complete pickup of jobless unplanned delivery");
  } else {
    fail("dispatcher jobless pickup", new Error(JSON.stringify(pickupResult.data)));
  }

  const pickedDelivery = await readDelivery(pickupId);
  const pickupEvents = await queryWhere("pickupEvents", "deliveryOrderId", pickupId);
  if (
    pickupEvents.length === 1 &&
    pickupEvents[0].technicianName === "Alex Recipient" &&
    pickupEvents[0].itemsPickedSummary === "2 boxes of fittings" &&
    typeof pickupEvents[0].pickedUpAt === "string" &&
    pickupEvents[0].pickedUpAt.length > 0 &&
    pickupEvents[0].jobId === "" &&
    pickupEvents[0].unplannedJoblessPickup === true
  ) {
    pass("pickup history records recipient, materials, and timestamp");
  } else {
    fail("pickup history", new Error(JSON.stringify(pickupEvents)));
  }

  if (
    pickedDelivery?.status === "picked_up" &&
    !String(pickedDelivery.stagingLocationId ?? "").trim()
  ) {
    pass("staging spot released after pickup");
  } else {
    fail("staging after pickup", new Error(JSON.stringify(pickedDelivery)));
  }

  const pickupRetry = await recordPickup({
    deliveryOrderId: pickupId,
    technicianName: "Alex Recipient",
    itemsPickedSummary: "2 boxes of fittings",
    clientOperationId: pickupOp,
  });
  const pickupEventsAfterRetry = await queryWhere(
    "pickupEvents",
    "deliveryOrderId",
    pickupId,
  );
  if (
    pickupRetry.data.duplicate === true &&
    pickupEventsAfterRetry.length === 1
  ) {
    pass("repeated pickup request does not create duplicate history");
  } else {
    fail(
      "pickup idempotency",
      new Error(JSON.stringify({ pickupRetry: pickupRetry.data, count: pickupEventsAfterRetry.length })),
    );
  }

  // 5–7, 10. Cancel / clear with reason; no pickup event; staging released; idempotent.
  const clearId = "unplanned-willcall-pickup_del-clear";
  await seed(async (db) => {
    await seedUnplannedStaged(db, {
      id: clearId,
      locId: "unplanned-willcall-pickup_loc-clear",
    });
  });
  const clearOp = "op-unplanned-clear-1";
  const clearResult = await clearStaged({
    deliveryOrderId: clearId,
    reason: "Vendor picked the freight back up",
    clientOperationId: clearOp,
  });
  if (
    clearResult.data.duplicate === false &&
    clearResult.data.deliveryStatus === "cancelled"
  ) {
    pass("authorized dispatcher can cancel with a reason");
  } else {
    fail("dispatcher clear", new Error(JSON.stringify(clearResult.data)));
  }

  const clearedDelivery = await readDelivery(clearId);
  const clearEvents = await queryWhere(
    "deliveryClearEvents",
    "deliveryOrderId",
    clearId,
  );
  const clearHistory = await queryWhere("statusHistory", "entityId", clearId);
  const clearPickupEvents = await queryWhere(
    "pickupEvents",
    "deliveryOrderId",
    clearId,
  );
  const cancelledHistory = clearHistory.filter((e) => e.toStatus === "cancelled");
  if (
    clearEvents.length === 1 &&
    clearEvents[0].reason === "Vendor picked the freight back up" &&
    clearEvents[0].clearedByUid === dispatcherUid &&
    cancelledHistory.length === 1 &&
    cancelledHistory[0].reason === "Vendor picked the freight back up" &&
    clearPickupEvents.length === 0 &&
    clearedDelivery?.status === "cancelled" &&
    clearedDelivery?.clearReason === "Vendor picked the freight back up"
  ) {
    pass("cancellation creates a clear event and status history, but no pickup event");
  } else {
    fail(
      "clear audit",
      new Error(
        JSON.stringify({
          clearEvents,
          cancelledHistory,
          clearPickupEvents,
          clearedDelivery,
        }),
      ),
    );
  }

  if (!String(clearedDelivery?.stagingLocationId ?? "").trim()) {
    pass("staging spot released after cancellation");
  } else {
    fail("staging after clear", new Error(JSON.stringify(clearedDelivery)));
  }

  const stillExists = await readDelivery(clearId);
  if (stillExists?.id === clearId) {
    pass("canceled delivery record is kept for audit");
  } else {
    fail("delivery deleted after clear", new Error(JSON.stringify(stillExists)));
  }

  const clearRetry = await clearStaged({
    deliveryOrderId: clearId,
    reason: "Vendor picked the freight back up",
    clientOperationId: clearOp,
  });
  const clearEventsAfterRetry = await queryWhere(
    "deliveryClearEvents",
    "deliveryOrderId",
    clearId,
  );
  if (clearRetry.data.duplicate === true && clearEventsAfterRetry.length === 1) {
    pass("repeated clear request does not create duplicate history");
  } else {
    fail(
      "clear idempotency",
      new Error(JSON.stringify({ clearRetry: clearRetry.data, count: clearEventsAfterRetry.length })),
    );
  }

  // 9. Canceled delivery cannot subsequently be picked up.
  try {
    await recordPickup({
      deliveryOrderId: clearId,
      technicianName: "Alex Recipient",
      itemsPickedSummary: "should fail",
      clientOperationId: "op-pickup-after-cancel",
    });
    fail("canceled delivery should not be pick-up-able");
  } catch {
    pass("canceled delivery cannot subsequently be picked up");
  }

  // Cannot cancel picked-up delivery.
  try {
    await clearStaged({
      deliveryOrderId: pickupId,
      reason: "too late",
      clientOperationId: "op-clear-after-pickup",
    });
    fail("picked-up delivery should not be cancellable");
  } catch {
    pass("picked-up delivery cannot be cancelled");
  }

  // 8. Unauthorized users cannot perform either operation.
  await signOut(auth);
  await seed(async (db) => {
    await seedUnplannedStaged(db, {
      id: "unplanned-willcall-pickup_del-unauth-pickup",
      locId: "unplanned-willcall-pickup_loc-unauth-p",
    });
    await seedUnplannedStaged(db, {
      id: "unplanned-willcall-pickup_del-unauth-clear",
      locId: "unplanned-willcall-pickup_loc-unauth-c",
    });
    await setDoc(doc(db, "pickupTokens", TEST_PICKUP_TOKEN_HASH), {
      id: TEST_PICKUP_TOKEN_HASH,
      jobId: "missing-job",
      tokenHash: TEST_PICKUP_TOKEN_HASH,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revokedAt: null,
      createdBy: "test",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  try {
    await recordPickup({
      deliveryOrderId: "unplanned-willcall-pickup_del-unauth-pickup",
      technicianName: "Token Tech",
      itemsPickedSummary: "should fail",
      clientOperationId: "op-token-jobless",
      pickupToken: TEST_PICKUP_TOKEN,
    });
    fail("pickup-token path must not pick up jobless unplanned");
  } catch {
    pass("pickup-token path cannot pick up jobless unplanned delivery");
  }

  try {
    await clearStaged({
      deliveryOrderId: "unplanned-willcall-pickup_del-unauth-clear",
      reason: "no auth",
      clientOperationId: "op-unauth-clear",
    });
    fail("unauthenticated clear should be denied");
  } catch {
    pass("unauthenticated user cannot cancel / clear");
  }

  const nonDispatcherUid = await ensureAuthUser(
    NON_DISPATCHER_EMAIL,
    NON_DISPATCHER_PASSWORD,
  );
  await seedDispatcherRole(nonDispatcherUid, { active: false, fullName: "No Role" });
  try {
    await recordPickup({
      deliveryOrderId: "unplanned-willcall-pickup_del-unauth-pickup",
      technicianName: "No Role",
      itemsPickedSummary: "should fail",
      clientOperationId: "op-norole-pickup",
    });
    fail("inactive dispatcher role should not pick up jobless unplanned");
  } catch {
    pass("signed-in non-dispatcher cannot complete jobless pickup");
  }
  try {
    await clearStaged({
      deliveryOrderId: "unplanned-willcall-pickup_del-unauth-clear",
      reason: "no role",
      clientOperationId: "op-norole-clear",
    });
    fail("inactive dispatcher role should not clear");
  } catch {
    pass("signed-in non-dispatcher cannot cancel / clear");
  }

  // 11. Normal job-linked pickup behavior remains unchanged.
  await ensureAuthUser(DISPATCHER_TEST_EMAIL, DISPATCHER_TEST_PASSWORD);
  await seedDispatcherRole(dispatcherUid);
  await seed(async (db) => {
    await seedJobLinkedReady(db, "unplanned-willcall-pickup_del-linked");
  });
  try {
    await recordPickup({
      deliveryOrderId: "unplanned-willcall-pickup_del-linked",
      technicianName: "Tech Linked",
      itemsPickedSummary: "1 item",
      clientOperationId: "op-linked-no-jobid",
    });
    fail("job-linked pickup without jobId should still fail");
  } catch {
    pass("job-linked pickup still requires jobId");
  }

  const linkedPickup = await recordPickup({
    deliveryOrderId: "unplanned-willcall-pickup_del-linked",
    jobId: "unplanned-willcall-pickup_del-linked-job",
    technicianName: "Tech Linked",
    itemsPickedSummary: "1 item",
    clientOperationId: "op-linked-ok",
  });
  if (linkedPickup.data.deliveryStatus === "picked_up") {
    pass("normal job-linked dispatcher pickup still succeeds");
  } else {
    fail("job-linked pickup", new Error(JSON.stringify(linkedPickup.data)));
  }

  await signOut(auth);
  try {
    await recordPickup({
      deliveryOrderId: "unplanned-willcall-pickup_del-linked",
      jobId: "unplanned-willcall-pickup_del-linked-job",
      technicianName: "Token Tech",
      itemsPickedSummary: "1 item",
      clientOperationId: "op-linked-already-picked",
      pickupToken: TEST_PICKUP_TOKEN,
    });
    // already picked_up — token path returns duplicate, not a new exception path
    pass("job-linked token path still reaches existing picked_up handling");
  } catch (err) {
    fail("job-linked token path after pickup", err);
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await testEnv.cleanup();
}
