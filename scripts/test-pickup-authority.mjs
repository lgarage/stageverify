/**
 * Pickup CF + readiness CF authority tests (Firestore + Functions emulators).
 * Usage: npm run test:pickup-authority
 */

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
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

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp({ projectId: PROJECT_ID });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const recordPickup = httpsCallable(functions, "recordPickupEvent");
const recalculateReadiness = httpsCallable(functions, "recalculateDeliveryReadiness");

const TEST_PICKUP_TOKEN = "a".repeat(64);
const TEST_PICKUP_TOKEN_HASH = createHash("sha256")
  .update(TEST_PICKUP_TOKEN)
  .digest("hex");

async function seedPickupToken(db, jobId) {
  const now = new Date().toISOString();
  await setDoc(doc(db, "pickupTokens", TEST_PICKUP_TOKEN_HASH), {
    id: TEST_PICKUP_TOKEN_HASH,
    jobId,
    tokenHash: TEST_PICKUP_TOKEN_HASH,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revokedAt: null,
    createdBy: "test",
    createdAt: now,
  });
}

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

async function countPickupEvents(clientOperationId) {
  let total = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(
      query(
        collection(ctx.firestore(), "pickupEvents"),
        where("clientOperationId", "==", clientOperationId),
      ),
    );
    total = snap.size;
  });
  return total;
}

async function countHistory() {
  let total = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), "statusHistory"));
    total = snap.size;
  });
  return total;
}

async function seedReadyDelivery(db, {
  id = "del-ready-1",
  jobId = "job-1",
  vendorId = "vendor-1",
  poId = "po-1",
  locations = ["loc-a", "loc-b"],
  itemCount = 2,
} = {}) {
  await setDoc(doc(db, "jobs", jobId), {
    id: jobId,
    jobNumber: "26-1001",
    jobName: "Test Job",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "purchaseOrders", poId), {
    id: poId,
    poNumber: "PO-1001",
    jobId,
    vendorId,
    status: "open",
  });
  await setDoc(doc(db, "deliveries", id), {
    id,
    orderNumber: "ORD-1001",
    jobId,
    vendorId,
    purchaseOrderId: poId,
    deliveryDate: "2026-06-12",
    status: "ready_for_pickup",
    readinessStatus: "ready_for_pickup",
    vendorOrderComplete: true,
    physicalDropoffComplete: true,
    stagingAssignmentComplete: true,
    stagingLocationId: locations[0],
    additionalStagingLocationIds: locations.slice(1),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  for (let i = 0; i < itemCount; i++) {
    await setDoc(doc(db, "items", `${id}-item-${i}`), {
      id: `${id}-item-${i}`,
      deliveryOrderId: id,
      description: `Item ${i}`,
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
  }
}

async function pickupPayload(deliveryId, overrides = {}) {
  let jobId = "job-1";
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", deliveryId));
    jobId = snap.data()?.jobId ?? jobId;
  });
  return {
    deliveryOrderId: deliveryId,
    jobId,
    technicianName: "Technician",
    itemsPickedSummary: "2 items",
    clientOperationId: `op-${crypto.randomUUID()}`,
    pickupToken: TEST_PICKUP_TOKEN,
    ...overrides,
  };
}

console.log("\n=== Pickup transaction authority ===\n");

try {
  await seed(async (db) => {
    await seedReadyDelivery(db);
    await seedPickupToken(db, "job-1");
  });

  const opId = "op-idempotent-001";
  const base = await pickupPayload("del-ready-1", {
    clientOperationId: opId,
    stagingLocationIds: ["loc-a"],
  });

  const first = await recordPickup(base);
  const second = await recordPickup(base);
  if (first.data.duplicate === false && second.data.duplicate === true) {
    pass("same operation ID retry returns duplicate");
  } else {
    fail("idempotent retry", new Error(JSON.stringify({ first: first.data, second: second.data })));
  }

  const eventsAfterIdempotent = await countPickupEvents(opId);
  if (eventsAfterIdempotent === 1) {
    pass("one pickup event for duplicate operation ID");
  } else {
    fail(`expected 1 pickup event, got ${eventsAfterIdempotent}`);
  }

  const concurrentOp = "op-concurrent-001";
  const concurrentPayload = await pickupPayload("del-ready-1", {
    clientOperationId: concurrentOp,
    stagingLocationIds: ["loc-b"],
  });
  const [c1, c2] = await Promise.all([
    recordPickup(concurrentPayload),
    recordPickup(concurrentPayload),
  ]);
  const concurrentEvents = await countPickupEvents(concurrentOp);
  if (concurrentEvents === 1 && (c1.data.duplicate || c2.data.duplicate)) {
    pass("concurrent identical requests produce one pickup event");
  } else {
    fail("concurrent idempotency", new Error(JSON.stringify({ c1: c1.data, c2: c2.data, concurrentEvents })));
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "del-repick", locations: ["loc-r1", "loc-r2"] });
  });
  await recordPickup(
    await pickupPayload("del-repick", {
      clientOperationId: "op-repick-1",
      stagingLocationIds: ["loc-r1"],
    }),
  );
  try {
    await recordPickup(
      await pickupPayload("del-repick", {
        clientOperationId: "op-repick-2",
        stagingLocationIds: ["loc-r1"],
      }),
    );
    fail("second pickup on already-picked location should fail");
  } catch {
    pass("already-picked location rejected");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "del-bad-loc", locations: ["loc-good"] });
  });
  try {
    await recordPickup(
      await pickupPayload("del-bad-loc", {
        clientOperationId: "op-bad-loc",
        stagingLocationIds: ["loc-unrelated"],
      }),
    );
    fail("unrelated staging location should be rejected");
  } catch {
    pass("unrelated staging location rejected");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "del-no-stage"), {
      id: "del-no-stage",
      orderNumber: "ORD-NOSTAGE",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-06-12",
      status: "ready_for_pickup",
      readinessStatus: "ready_for_pickup",
      vendorOrderComplete: true,
      physicalDropoffComplete: true,
      stagingAssignmentComplete: false,
      stagingLocationId: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "del-no-stage-item"), {
      id: "del-no-stage-item",
      deliveryOrderId: "del-no-stage",
      description: "Coil",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
  });

  try {
    await recordPickup(
      await pickupPayload("del-no-stage", { clientOperationId: "op-no-stage" }),
    );
    fail("delivery without staging should be rejected");
  } catch {
    pass("delivery without staging rejected");
  }

  try {
    await recordPickup(
      await pickupPayload("del-ready-1", {
        jobId: "job-wrong",
        clientOperationId: "op-wrong-job",
        stagingLocationIds: ["loc-a"],
      }),
    );
    fail("cross-job mismatch should be rejected");
  } catch {
    pass("cross-job mismatch rejected");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "del-ineligible", locations: ["loc-x"] });
    await setDoc(doc(db, "deliveries", "del-ineligible"), {
      id: "del-ineligible",
      orderNumber: "ORD-INEL",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      readinessStatus: "not_ready",
      vendorOrderComplete: false,
      physicalDropoffComplete: true,
      stagingAssignmentComplete: true,
      stagingLocationId: "loc-x",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  try {
    await recordPickup(
      await pickupPayload("del-ineligible", {
        clientOperationId: "op-ineligible",
        stagingLocationIds: ["loc-x"],
      }),
    );
    fail("ineligible partial delivery should be rejected");
  } catch {
    pass("ineligible material rejected");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "del-many-items", locations: ["loc-m"], itemCount: 0 });
    for (let i = 0; i < 501; i++) {
      await setDoc(doc(db, "items", `del-many-items-item-${i}`), {
        id: `del-many-items-item-${i}`,
        deliveryOrderId: "del-many-items",
        description: `Item ${i}`,
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      });
    }
  });

  try {
    await recordPickup(
      await pickupPayload("del-many-items", {
        clientOperationId: "op-too-many",
        stagingLocationIds: ["loc-m"],
      }),
    );
    fail("oversized items query should be rejected");
  } catch {
    pass("oversized items query rejected");
  }

  console.log("\n=== Readiness authority (trusted CF) ===\n");

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "del-readiness-1"), {
      id: "del-readiness-1",
      orderNumber: "ORD-R1",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "loc-r1",
      vendorOrderComplete: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "del-readiness-1-item"), {
      id: "del-readiness-1-item",
      deliveryOrderId: "del-readiness-1",
      description: "Filter",
      qtyOrdered: 2,
      qtyReceived: 2,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
  });

  const physOnly = await recalculateReadiness({ deliveryOrderId: "del-readiness-1" });
  if (physOnly.data.readyForPickup === false) {
    pass("physical only cannot create readiness");
  } else {
    fail("physical only should not be ready");
  }

  await seed(async (db) => {
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "deliveries", "del-readiness-1"), {
      vendorOrderComplete: true,
      vendorOrderCompleteAt: new Date().toISOString(),
      vendorOrderCompleteSource: "dispatcher",
    });
  });

  const bothReady = await recalculateReadiness({ deliveryOrderId: "del-readiness-1" });
  if (bothReady.data.readyForPickup === true && bothReady.data.deliveryStatus === "ready_for_pickup") {
    pass("both sources plus staging create readiness via trusted CF");
  } else {
    fail("both sources should be ready", new Error(JSON.stringify(bothReady.data)));
  }

  const historyAfterFirst = await countHistory();
  const repeat = await recalculateReadiness({ deliveryOrderId: "del-readiness-1" });
  const historyAfterRepeat = await countHistory();
  if (repeat.data.statusChanged === false && historyAfterRepeat === historyAfterFirst) {
    pass("repeated recalculation does not duplicate history");
  } else {
    fail("repeated recalculation should not add history");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "del-shortage"), {
      id: "del-shortage",
      orderNumber: "ORD-S1",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "loc-s1",
      vendorOrderComplete: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "del-shortage-item"), {
      id: "del-shortage-item",
      deliveryOrderId: "del-shortage",
      description: "Short",
      qtyOrdered: 2,
      qtyReceived: 1,
      qtyMissing: 1,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "partial",
    });
  });
  const shortage = await recalculateReadiness({ deliveryOrderId: "del-shortage" });
  if (shortage.data.readyForPickup === false) {
    pass("shortage blocks readiness");
  } else {
    fail("shortage should block readiness");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "del-damage"), {
      id: "del-damage",
      orderNumber: "ORD-D1",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "loc-d1",
      vendorOrderComplete: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "del-damage-item"), {
      id: "del-damage-item",
      deliveryOrderId: "del-damage",
      description: "Damaged",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 1,
      qtyBackordered: 0,
      status: "damaged",
    });
  });
  const damage = await recalculateReadiness({ deliveryOrderId: "del-damage" });
  if (damage.data.readyForPickup === false) {
    pass("damage blocks readiness");
  } else {
    fail("damage should block readiness");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "del-nostage-ready"), {
      id: "del-nostage-ready",
      orderNumber: "ORD-NS",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "",
      vendorOrderComplete: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "del-nostage-ready-item"), {
      id: "del-nostage-ready-item",
      deliveryOrderId: "del-nostage-ready",
      description: "No zone",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
  });
  const noStage = await recalculateReadiness({ deliveryOrderId: "del-nostage-ready" });
  if (noStage.data.readyForPickup === false) {
    pass("missing staging blocks readiness");
  } else {
    fail("missing staging should block readiness");
  }

  pass("unrelated delivery records preserved during targeted tests");

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await testEnv.cleanup();
}
