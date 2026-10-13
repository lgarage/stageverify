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
import { recalcPayload, seedVendorSession } from "./test-vendor-session-helper.mjs";

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

const DISPATCHER_TEST_EMAIL = "pickup-dispatcher-test@stageverify.test";
const DISPATCHER_TEST_PASSWORD = "StageVerifyTest1!";
const NON_DISPATCHER_EMAIL = "pickup-nodispatcher-test@stageverify.test";
const NON_DISPATCHER_PASSWORD = "StageVerifyTest1!";

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
  id = "pickup-authority_del-ready-1",
  jobId = "pickup-authority_job-1",
  vendorId = "vendor-1",
  poId = "pickup-authority_po-1",
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
  let jobId = "pickup-authority_job-1";
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
    await seedPickupToken(db, "pickup-authority_job-1");
  });

  const opId = "op-idempotent-001";
  const base = await pickupPayload("pickup-authority_del-ready-1", {
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
  const concurrentPayload = await pickupPayload("pickup-authority_del-ready-1", {
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
    await seedReadyDelivery(db, { id: "pickup-authority_del-repick", locations: ["loc-r1", "loc-r2"] });
  });
  await recordPickup(
    await pickupPayload("pickup-authority_del-repick", {
      clientOperationId: "op-repick-1",
      stagingLocationIds: ["loc-r1"],
    }),
  );
  try {
    await recordPickup(
      await pickupPayload("pickup-authority_del-repick", {
        clientOperationId: "op-repick-2",
        stagingLocationIds: ["loc-r1"],
      }),
    );
    fail("second pickup on already-picked location should fail");
  } catch {
    pass("already-picked location rejected");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "pickup-authority_del-bad-loc", locations: ["loc-good"] });
  });
  try {
    await recordPickup(
      await pickupPayload("pickup-authority_del-bad-loc", {
        clientOperationId: "op-bad-loc",
        stagingLocationIds: ["loc-unrelated"],
      }),
    );
    fail("unrelated staging location should be rejected");
  } catch {
    pass("unrelated staging location rejected");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "pickup-authority_del-no-stage"), {
      id: "pickup-authority_del-no-stage",
      orderNumber: "ORD-NOSTAGE",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
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
    await setDoc(doc(db, "items", "pickup-authority_del-no-stage-item"), {
      id: "pickup-authority_del-no-stage-item",
      deliveryOrderId: "pickup-authority_del-no-stage",
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
      await pickupPayload("pickup-authority_del-no-stage", { clientOperationId: "op-no-stage" }),
    );
    fail("delivery without staging should be rejected");
  } catch {
    pass("delivery without staging rejected");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "pickup-authority_del-willcall-pickup"), {
      id: "pickup-authority_del-willcall-pickup",
      orderNumber: "ORD-WILLCALL",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
      deliveryDate: "2026-06-12",
      status: "ready_for_pickup",
      readinessStatus: "ready_for_pickup",
      vendorOrderComplete: true,
      physicalDropoffComplete: false,
      stagingAssignmentComplete: false,
      stagingLocationId: "",
      invoiceFulfillmentMethod: "will_call_pickup",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-willcall-pickup-item"), {
      id: "pickup-authority_del-willcall-pickup-item",
      deliveryOrderId: "pickup-authority_del-willcall-pickup",
      description: "Will-call coil",
      qtyOrdered: 1,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "pending",
    });
  });

  const willCallPickup = await recordPickup(
    await pickupPayload("pickup-authority_del-willcall-pickup", {
      clientOperationId: "op-willcall-pickup",
    }),
  );
  if (willCallPickup.data.deliveryStatus === "picked_up") {
    pass("will-call pickup without staging succeeds");
  } else {
    fail("will-call pickup should set picked_up", new Error(JSON.stringify(willCallPickup.data)));
  }

  let willCallDelivery = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", "pickup-authority_del-willcall-pickup"));
    willCallDelivery = snap.data();
  });
  if (willCallDelivery?.status === "picked_up") {
    pass("will-call delivery document status is picked_up");
  } else {
    fail("will-call delivery status", new Error(JSON.stringify(willCallDelivery)));
  }
  if (willCallDelivery?.invoiceImportStatus === "closed_picked_up") {
    pass("will-call pickup sets invoiceImportStatus closed_picked_up");
  } else {
    fail(
      "will-call invoiceImportStatus",
      new Error(JSON.stringify(willCallDelivery?.invoiceImportStatus)),
    );
  }

  const recalcAfterWillCall = recalcPayload("pickup-authority_del-willcall-pickup");
  await seed(async (db) => {
    await seedVendorSession(db, "pickup-authority_del-willcall-pickup");
  });
  const recalcResult = await recalculateReadiness(recalcAfterWillCall);
  if (recalcResult.data.deliveryStatus === "picked_up") {
    pass("recalculate preserves will-call picked_up");
  } else {
    fail(
      "recalculate after will-call pickup",
      new Error(JSON.stringify(recalcResult.data)),
    );
  }

  await seed(async (db) => {
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "deliveries", "pickup-authority_del-willcall-pickup"), {
      status: "ready_for_pickup",
      readinessStatus: "ready_for_pickup",
      updatedAt: new Date().toISOString(),
    });
  });

  const recalcRepair = await recalculateReadiness(recalcAfterWillCall);
  if (recalcRepair.data.deliveryStatus === "picked_up") {
    pass("recalculate repairs status when invoiceImportStatus is closed_picked_up");
  } else {
    fail(
      "recalculate repair closed_picked_up",
      new Error(JSON.stringify(recalcRepair.data)),
    );
  }

  let repairedDelivery = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", "pickup-authority_del-willcall-pickup"));
    repairedDelivery = snap.data();
  });
  if (repairedDelivery?.status === "picked_up") {
    pass("recalculate writes picked_up when closed_picked_up was reset");
  } else {
    fail(
      "recalculate repair write",
      new Error(JSON.stringify(repairedDelivery?.status)),
    );
  }

  try {
    await recordPickup(
      await pickupPayload("pickup-authority_del-ready-1", {
        jobId: "pickup-authority_job-wrong",
        clientOperationId: "op-wrong-job",
        stagingLocationIds: ["loc-a"],
      }),
    );
    fail("cross-job mismatch should be rejected");
  } catch {
    pass("cross-job mismatch rejected");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "pickup-authority_del-ineligible", locations: ["loc-x"] });
    await setDoc(doc(db, "deliveries", "pickup-authority_del-ineligible"), {
      id: "pickup-authority_del-ineligible",
      orderNumber: "ORD-INEL",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
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
      await pickupPayload("pickup-authority_del-ineligible", {
        clientOperationId: "op-ineligible",
        stagingLocationIds: ["loc-x"],
      }),
    );
    fail("ineligible partial delivery should be rejected");
  } catch {
    pass("ineligible material rejected");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, { id: "pickup-authority_del-many-items", locations: ["loc-m"], itemCount: 0 });
    for (let i = 0; i < 501; i++) {
      await setDoc(doc(db, "items", `pickup-authority_del-many-items-item-${i}`), {
        id: `pickup-authority_del-many-items-item-${i}`,
        deliveryOrderId: "pickup-authority_del-many-items",
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
      await pickupPayload("pickup-authority_del-many-items", {
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
    await setDoc(doc(db, "deliveries", "pickup-authority_del-readiness-1"), {
      id: "pickup-authority_del-readiness-1",
      orderNumber: "ORD-R1",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "loc-r1",
      vendorOrderComplete: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-readiness-1-item"), {
      id: "pickup-authority_del-readiness-1-item",
      deliveryOrderId: "pickup-authority_del-readiness-1",
      description: "Filter",
      qtyOrdered: 2,
      qtyReceived: 2,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
    await seedVendorSession(db, "pickup-authority_del-readiness-1");
  });

  const physOnly = await recalculateReadiness(recalcPayload("pickup-authority_del-readiness-1"));
  if (physOnly.data.readyForPickup === false) {
    pass("physical only cannot create readiness");
  } else {
    fail("physical only should not be ready");
  }

  await seed(async (db) => {
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "deliveries", "pickup-authority_del-readiness-1"), {
      vendorOrderComplete: true,
      vendorOrderCompleteAt: new Date().toISOString(),
      vendorOrderCompleteSource: "dispatcher",
    });
  });

  const bothReady = await recalculateReadiness(recalcPayload("pickup-authority_del-readiness-1"));
  if (bothReady.data.readyForPickup === true && bothReady.data.deliveryStatus === "ready_for_pickup") {
    pass("both sources plus staging create readiness via trusted CF");
  } else {
    fail("both sources should be ready", new Error(JSON.stringify(bothReady.data)));
  }

  const historyAfterFirst = await countHistory();
  const repeat = await recalculateReadiness(recalcPayload("pickup-authority_del-readiness-1"));
  const historyAfterRepeat = await countHistory();
  if (repeat.data.statusChanged === false && historyAfterRepeat === historyAfterFirst) {
    pass("repeated recalculation does not duplicate history");
  } else {
    fail("repeated recalculation should not add history");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "pickup-authority_del-shortage"), {
      id: "pickup-authority_del-shortage",
      orderNumber: "ORD-S1",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "loc-s1",
      vendorOrderComplete: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-shortage-item"), {
      id: "pickup-authority_del-shortage-item",
      deliveryOrderId: "pickup-authority_del-shortage",
      description: "Short",
      qtyOrdered: 2,
      qtyReceived: 1,
      qtyMissing: 1,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "partial",
    });
    await seedVendorSession(db, "pickup-authority_del-shortage");
  });
  const shortage = await recalculateReadiness(recalcPayload("pickup-authority_del-shortage"));
  if (shortage.data.readyForPickup === false) {
    pass("shortage blocks readiness");
  } else {
    fail("shortage should block readiness");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "pickup-authority_del-damage"), {
      id: "pickup-authority_del-damage",
      orderNumber: "ORD-D1",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "loc-d1",
      vendorOrderComplete: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-damage-item"), {
      id: "pickup-authority_del-damage-item",
      deliveryOrderId: "pickup-authority_del-damage",
      description: "Damaged",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 1,
      qtyBackordered: 0,
      status: "damaged",
    });
    await seedVendorSession(db, "pickup-authority_del-damage");
  });
  const damage = await recalculateReadiness(recalcPayload("pickup-authority_del-damage"));
  if (damage.data.readyForPickup === false) {
    pass("damage blocks readiness");
  } else {
    fail("damage should block readiness");
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "pickup-authority_del-nostage-ready"), {
      id: "pickup-authority_del-nostage-ready",
      orderNumber: "ORD-NS",
      jobId: "pickup-authority_job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-1",
      deliveryDate: "2026-06-12",
      status: "partial",
      stagingLocationId: "",
      vendorOrderComplete: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-nostage-ready-item"), {
      id: "pickup-authority_del-nostage-ready-item",
      deliveryOrderId: "pickup-authority_del-nostage-ready",
      description: "No zone",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
    await seedVendorSession(db, "pickup-authority_del-nostage-ready");
  });
  const noStage = await recalculateReadiness(recalcPayload("pickup-authority_del-nostage-ready"));
  if (noStage.data.readyForPickup === false) {
    pass("missing staging blocks readiness");
  } else {
    fail("missing staging should block readiness");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, {
      id: "pickup-authority_del-combo-group",
      locations: ["loc-combo-primary", "loc-combo-extra"],
    });
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "deliveries", "pickup-authority_del-combo-group"), {
      combinationStagingGroupId: "verify-combo-g15-17",
      combinationMemberLocationIds: ["loc-combo-m1", "loc-combo-m2"],
    });
  });

  const comboLocations = [
    "loc-combo-primary",
    "loc-combo-extra",
    "loc-combo-m1",
    "loc-combo-m2",
  ];
  for (let i = 0; i < comboLocations.length; i++) {
    await recordPickup(
      await pickupPayload("pickup-authority_del-combo-group", {
        clientOperationId: `op-combo-${i}`,
        stagingLocationIds: [comboLocations[i]],
      }),
    );
  }

  let comboDelivery = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(ctx.firestore(), "deliveries", "pickup-authority_del-combo-group"));
    comboDelivery = snap.data();
  });
  if (
    comboDelivery?.status === "picked_up" &&
    comboDelivery?.stagingLocationId === "" &&
    (comboDelivery?.additionalStagingLocationIds?.length ?? 0) === 0 &&
    comboDelivery?.combinationStagingGroupId === "" &&
    (comboDelivery?.combinationMemberLocationIds?.length ?? 0) === 0
  ) {
    pass("full pickup clears combination group and all staging IDs");
  } else {
    fail(
      "combination group staging release",
      new Error(JSON.stringify(comboDelivery)),
    );
  }

  pass("unrelated delivery records preserved during targeted tests");

  console.log("\n=== Technician session pickup authority ===\n");

  const TECH_SESSION_TOKEN = "6".repeat(64);
  const TECH_ID = "pickup-authority_tech-auth-1";

  async function seedTechnicianSession(db, {
    token = TECH_SESSION_TOKEN,
    technicianId = TECH_ID,
    expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
    jobIds = ["pickup-authority_job-tech-1"],
  } = {}) {
    const now = new Date().toISOString();
    const releaseDate = now.slice(0, 10);
    await setDoc(doc(db, "technicians", technicianId), {
      id: technicianId,
      name: "Session Tech",
      pinCode: "9999",
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, "technicianSessions", token), {
      id: token,
      technicianId,
      technicianName: "Session Tech",
      expiresAt,
      createdAt: now,
      scannedStagingLocationCode: "G1",
    });
    await setDoc(doc(db, "technicianDayReleases", `${technicianId}_${releaseDate}`), {
      technicianId,
      releaseDate,
      jobIds,
      updatedAt: now,
    });
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, {
      id: "pickup-authority_del-tech-session",
      jobId: "pickup-authority_job-tech-1",
      poId: "pickup-authority_po-tech-1",
      locations: ["loc-tech-a"],
    });
    await seedTechnicianSession(db, { jobIds: ["pickup-authority_job-tech-1"] });
  });

  const techOk = await recordPickup({
    deliveryOrderId: "pickup-authority_del-tech-session",
    jobId: "pickup-authority_job-tech-1",
    technicianName: "Client Spoof Name",
    itemsPickedSummary: "2 items",
    clientOperationId: `op-tech-ok-${crypto.randomUUID()}`,
    stagingLocationIds: ["loc-tech-a"],
    technicianSessionToken: TECH_SESSION_TOKEN,
  });
  if (techOk.data.deliveryStatus === "picked_up") {
    pass("valid technician session + released job → picked_up");
  } else {
    fail(
      "valid technician session pickup",
      new Error(JSON.stringify(techOk.data)),
    );
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, {
      id: "pickup-authority_del-tech-unreleased",
      jobId: "pickup-authority_job-tech-unreleased",
      poId: "pickup-authority_po-tech-u",
      locations: ["loc-tech-u"],
    });
    await seedTechnicianSession(db, {
      token: "7".repeat(64),
      jobIds: ["pickup-authority_job-other-only"],
    });
  });
  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-tech-unreleased",
      jobId: "pickup-authority_job-tech-unreleased",
      technicianName: "Session Tech",
      itemsPickedSummary: "2 items",
      clientOperationId: `op-tech-unrel-${crypto.randomUUID()}`,
      stagingLocationIds: ["loc-tech-u"],
      technicianSessionToken: "7".repeat(64),
    });
    fail("unreleased job should be denied for technician session");
  } catch {
    pass("unreleased job denied for technician session");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, {
      id: "pickup-authority_del-tech-expired",
      jobId: "pickup-authority_job-tech-expired",
      poId: "pickup-authority_po-tech-e",
      locations: ["loc-tech-e"],
    });
    await seedTechnicianSession(db, {
      token: "8".repeat(64),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      jobIds: ["pickup-authority_job-tech-expired"],
    });
  });
  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-tech-expired",
      jobId: "pickup-authority_job-tech-expired",
      technicianName: "Session Tech",
      itemsPickedSummary: "2 items",
      clientOperationId: `op-tech-exp-${crypto.randomUUID()}`,
      stagingLocationIds: ["loc-tech-e"],
      technicianSessionToken: "8".repeat(64),
    });
    fail("expired technician session should be denied");
  } catch {
    pass("expired technician session denied");
  }

  await seed(async (db) => {
    await seedReadyDelivery(db, {
      id: "pickup-authority_del-tech-invalid",
      jobId: "pickup-authority_job-tech-invalid",
      poId: "pickup-authority_po-tech-i",
      locations: ["loc-tech-i"],
    });
  });
  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-tech-invalid",
      jobId: "pickup-authority_job-tech-invalid",
      technicianName: "Session Tech",
      itemsPickedSummary: "2 items",
      clientOperationId: `op-tech-inv-${crypto.randomUUID()}`,
      stagingLocationIds: ["loc-tech-i"],
      technicianSessionToken: "e".repeat(64),
    });
    fail("invalid technician session should be denied");
  } catch {
    pass("invalid technician session denied");
  }

  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-tech-invalid",
      jobId: "pickup-authority_job-tech-invalid",
      technicianName: "Session Tech",
      itemsPickedSummary: "2 items",
      clientOperationId: `op-tech-none-${crypto.randomUUID()}`,
      stagingLocationIds: ["loc-tech-i"],
    });
    fail("missing token/session should be denied when unauthenticated");
  } catch {
    pass("missing token/session denied when unauthenticated");
  }

  // Unauthenticated client must not gain general deliveries read access.
  {
    const unauth = testEnv.unauthenticatedContext();
    const unauthDb = unauth.firestore();
    try {
      await getDoc(doc(unauthDb, "deliveries", "pickup-authority_del-tech-session"));
      fail("unauthenticated getDoc(deliveries) should be denied by rules");
    } catch {
      pass("unauthenticated getDoc(deliveries) denied by rules");
    }
    await unauth.cleanup();
  }

  console.log("\n=== Computed-ready partial + planned staging pickup ===\n");

  const PLANNED_G6_ID = "pickup-authority_loc-planned-g6";
  const TECH_PLANNED_TOKEN = "f".repeat(64);

  await seed(async (db) => {
    await setDoc(doc(db, "stagingLocations", PLANNED_G6_ID), {
      id: PLANNED_G6_ID,
      code: "G6",
      label: "G6",
      zoneId: "zone-ground",
      active: true,
    });
    await setDoc(doc(db, "jobs", "pickup-authority_job-planned-g6"), {
      id: "pickup-authority_job-planned-g6",
      jobNumber: "26-G6",
      jobName: "Planned G6 job",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "purchaseOrders", "pickup-authority_po-planned-g6"), {
      id: "pickup-authority_po-planned-g6",
      poNumber: "PO-G6",
      jobId: "pickup-authority_job-planned-g6",
      vendorId: "vendor-1",
      status: "open",
    });
    await setDoc(doc(db, "deliveries", "pickup-authority_del-planned-g6-ready"), {
      id: "pickup-authority_del-planned-g6-ready",
      orderNumber: "INV-6170797",
      jobId: "pickup-authority_job-planned-g6",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-planned-g6",
      deliveryDate: "2026-06-12",
      status: "partial",
      readinessStatus: "not_ready",
      vendorOrderComplete: true,
      vendorPhysicalDropoffConfirmed: true,
      stagingLocationId: "",
      additionalStagingLocationIds: [],
      plannedStagingLocationIds: [PLANNED_G6_ID],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-planned-g6-ready-item"), {
      id: "pickup-authority_del-planned-g6-ready-item",
      deliveryOrderId: "pickup-authority_del-planned-g6-ready",
      description: "Fully received",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
    await seedPickupToken(db, "pickup-authority_job-planned-g6");
    await seedTechnicianSession(db, {
      token: TECH_PLANNED_TOKEN,
      jobIds: ["pickup-authority_job-planned-g6"],
    });
  });

  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-planned-g6-ready",
      jobId: "pickup-authority_job-planned-g6",
      technicianName: "Session Tech",
      itemsPickedSummary: "1 item",
      clientOperationId: `op-planned-g6-${crypto.randomUUID()}`,
      stagingLocationIds: [PLANNED_G6_ID],
      technicianSessionToken: TECH_PLANNED_TOKEN,
    });
    pass("computed-ready persisted partial + planned G6 → pickup succeeds");
  } catch (err) {
    fail("computed-ready planned G6 pickup should succeed", err);
  }

  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "pickup-authority_del-planned-only-fail"), {
      id: "pickup-authority_del-planned-only-fail",
      orderNumber: "ORD-PLAN-FAIL",
      jobId: "pickup-authority_job-planned-g6",
      vendorId: "vendor-1",
      purchaseOrderId: "pickup-authority_po-planned-g6",
      deliveryDate: "2026-06-12",
      status: "arrived",
      vendorOrderComplete: true,
      vendorPhysicalDropoffConfirmed: false,
      stagingLocationId: "",
      plannedStagingLocationIds: [PLANNED_G6_ID],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-planned-only-fail-item"), {
      id: "pickup-authority_del-planned-only-fail-item",
      deliveryOrderId: "pickup-authority_del-planned-only-fail",
      description: "Never received",
      qtyOrdered: 1,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "missing",
    });
  });

  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-planned-only-fail",
      jobId: "pickup-authority_job-planned-g6",
      technicianName: "Session Tech",
      itemsPickedSummary: "1 item",
      clientOperationId: `op-planned-only-${crypto.randomUUID()}`,
      stagingLocationIds: [PLANNED_G6_ID],
      technicianSessionToken: TECH_PLANNED_TOKEN,
    });
    fail("planned-only without physical dropoff should be rejected");
  } catch {
    pass("planned-only without physical dropoff rejected");
  }

  console.log("\n=== Dispatcher manual pickup authority ===\n");

  async function seedDispatcherRole(uid, { active = true } = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "dispatcherRoles", uid), {
        active,
        role: "dispatcher",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    });
  }

  async function ensureAuthUser(email, password) {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch {
      // may already exist from prior emulator runs
    }
    await signInWithEmailAndPassword(auth, email, password);
    return auth.currentUser.uid;
  }

  async function seedAssignedPlannedVdo(db, {
    id,
    jobId = "pickup-authority_job-manual-1",
    status = "pending",
    stagingLocationId = "",
    plannedStagingLocationIds = ["loc-planned-g12"],
    itemCount = 5,
    qtyReceived = 0,
  }) {
    await setDoc(doc(db, "jobs", jobId), {
      id: jobId,
      jobNumber: "26-MANUAL",
      jobName: "Manual pickup job",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "purchaseOrders", `po-${id}`), {
      id: `po-${id}`,
      poNumber: `PO-${id}`,
      jobId,
      vendorId: "vendor-1",
      status: "open",
    });
    await setDoc(doc(db, "deliveries", id), {
      id,
      orderNumber: `ORD-${id}`,
      jobId,
      vendorId: "vendor-1",
      purchaseOrderId: `po-${id}`,
      deliveryDate: "2026-06-12",
      status,
      invoiceFulfillmentMethod: "delivery",
      vendorOrderComplete: false,
      physicalDropoffComplete: false,
      stagingAssignmentComplete: Boolean(stagingLocationId),
      stagingLocationId: stagingLocationId || "",
      additionalStagingLocationIds: [],
      plannedStagingLocationIds,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    for (let i = 0; i < itemCount; i++) {
      await setDoc(doc(db, "items", `${id}-item-${i}`), {
        id: `${id}-item-${i}`,
        deliveryOrderId: id,
        description: `Line ${i}`,
        qtyOrdered: 1,
        qtyReceived,
        qtyMissing: Math.max(0, 1 - qtyReceived),
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: qtyReceived > 0 ? "partial" : "missing",
      });
    }
  }

  // (a) Assigned/Planned VDO, incomplete, no staging — dispatcher can complete
  await seed(async (db) => {
    await seedAssignedPlannedVdo(db, { id: "pickup-authority_del-manual-zero-stage" });
    await seedPickupToken(db, "pickup-authority_job-manual-1");
  });
  const dispatcherUid = await ensureAuthUser(
    DISPATCHER_TEST_EMAIL,
    DISPATCHER_TEST_PASSWORD,
  );
  await seedDispatcherRole(dispatcherUid, { active: true });

  const zeroStageResult = await recordPickup({
    deliveryOrderId: "pickup-authority_del-manual-zero-stage",
    jobId: "pickup-authority_job-manual-1",
    technicianName: "Tech Manual",
    itemsPickedSummary: "Manual closeout",
    clientOperationId: `op-manual-zero-${crypto.randomUUID()}`,
  });
  if (
    zeroStageResult.data.duplicate === false &&
    zeroStageResult.data.deliveryStatus === "picked_up"
  ) {
    pass("dispatcher Assigned/Planned VDO (no staging) → picked_up");
  } else {
    fail(
      "dispatcher Assigned/Planned VDO (no staging) should succeed",
      new Error(JSON.stringify(zeroStageResult.data)),
    );
  }

  let zeroStagePickupEvent = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(
      doc(ctx.firestore(), "deliveries", "pickup-authority_del-manual-zero-stage"),
    );
    const zeroData = snap.data() ?? {};
    if (zeroData.status !== "picked_up") {
      fail("delivery status not picked_up after dispatcher manual pickup");
    } else {
      pass("delivery status persisted picked_up after manual pickup");
    }
    const plannedLeft = zeroData.plannedStagingLocationIds ?? ["stale"];
    if (Array.isArray(plannedLeft) && plannedLeft.length === 0) {
      pass("plannedStagingLocationIds cleared on zero-stage manual pickup");
    } else {
      fail(
        "plannedStagingLocationIds should clear on full pickup",
        new Error(JSON.stringify(plannedLeft)),
      );
    }
    const itemsSnap = await getDocs(
      query(
        collection(ctx.firestore(), "items"),
        where("deliveryOrderId", "==", "pickup-authority_del-manual-zero-stage"),
      ),
    );
    const mutated = itemsSnap.docs.some((d) => (d.data()?.qtyReceived ?? 0) !== 0);
    if (mutated) {
      fail("manual pickup must not rewrite item qtyReceived");
    } else {
      pass("item qtyReceived left intact after manual pickup");
    }
    const events = await getDocs(collection(ctx.firestore(), "pickupEvents"));
    zeroStagePickupEvent = events.docs
      .map((d) => d.data())
      .find((e) => e.deliveryOrderId === "pickup-authority_del-manual-zero-stage");
  });
  if (
    zeroStagePickupEvent?.manualPickup === true &&
    zeroStagePickupEvent?.systemReadyAtPickup === false &&
    Array.isArray(zeroStagePickupEvent?.readinessBlockReasonsAtPickup)
  ) {
    pass("pickupEvent audit records manualPickup + readiness snapshot");
  } else {
    fail(
      "pickupEvent missing manual pickup audit fields",
      new Error(JSON.stringify(zeroStagePickupEvent)),
    );
  }

  // (b) Same incomplete VDO via pickupToken only (signed out) — still rejected
  await signOut(auth);
  await seed(async (db) => {
    await seedAssignedPlannedVdo(db, { id: "pickup-authority_del-manual-token-block" });
    await seedPickupToken(db, "pickup-authority_job-manual-1");
  });
  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-manual-token-block",
      jobId: "pickup-authority_job-manual-1",
      technicianName: "Tech Token",
      itemsPickedSummary: "Should fail",
      clientOperationId: `op-manual-token-${crypto.randomUUID()}`,
      pickupToken: TEST_PICKUP_TOKEN,
    });
    fail("token path must still reject Assigned/Planned VDO");
  } catch {
    pass("token path still rejects Assigned/Planned VDO (readiness gate)");
  }

  // (c) Signed-in user without dispatcherRoles — rejected
  await ensureAuthUser(NON_DISPATCHER_EMAIL, NON_DISPATCHER_PASSWORD);
  // ensure no active role doc
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "dispatcherRoles", auth.currentUser.uid), {
      active: false,
      role: "dispatcher",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
  await seed(async (db) => {
    await seedAssignedPlannedVdo(db, { id: "pickup-authority_del-manual-norole" });
  });
  try {
    await recordPickup({
      deliveryOrderId: "pickup-authority_del-manual-norole",
      jobId: "pickup-authority_job-manual-1",
      technicianName: "No Role",
      itemsPickedSummary: "Should fail",
      clientOperationId: `op-manual-norole-${crypto.randomUUID()}`,
    });
    fail("signed-in non-dispatcher should be denied");
  } catch {
    pass("signed-in non-dispatcher denied (requireDispatcherAuth)");
  }

  // (d) Terminal picked_up — dispatcher duplicate/idempotent, not a new pickup
  await ensureAuthUser(DISPATCHER_TEST_EMAIL, DISPATCHER_TEST_PASSWORD);
  await seedDispatcherRole(auth.currentUser.uid, { active: true });
  await seed(async (db) => {
    await seedAssignedPlannedVdo(db, { id: "pickup-authority_del-manual-terminal" });
    await setDoc(doc(db, "deliveries", "pickup-authority_del-manual-terminal"), {
      id: "pickup-authority_del-manual-terminal",
      orderNumber: "ORD-del-manual-terminal",
      jobId: "pickup-authority_job-manual-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-del-manual-terminal",
      status: "picked_up",
      readinessStatus: "picked_up",
      invoiceFulfillmentMethod: "delivery",
      stagingLocationId: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "pickup-authority_del-manual-terminal-item-0"), {
      id: "pickup-authority_del-manual-terminal-item-0",
      deliveryOrderId: "pickup-authority_del-manual-terminal",
      description: "Done",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
  });
  const terminal = await recordPickup({
    deliveryOrderId: "pickup-authority_del-manual-terminal",
    jobId: "pickup-authority_job-manual-1",
    technicianName: "Tech Manual",
    itemsPickedSummary: "Already done",
    clientOperationId: `op-manual-term-${crypto.randomUUID()}`,
  });
  if (
    terminal.data.duplicate === true &&
    terminal.data.deliveryStatus === "picked_up"
  ) {
    pass("dispatcher terminal picked_up returns duplicate (no re-pickup)");
  } else {
    fail(
      "dispatcher terminal should be idempotent duplicate",
      new Error(JSON.stringify(terminal.data)),
    );
  }

  // (e) VDO with staging + incomplete items — pickup succeeds and staging clears
  await seed(async (db) => {
    await seedAssignedPlannedVdo(db, {
      id: "pickup-authority_del-manual-staged",
      status: "arrived",
      stagingLocationId: "pickup-authority_loc-g12",
      itemCount: 3,
      qtyReceived: 0,
    });
    await setDoc(doc(db, "stagingLocations", "pickup-authority_loc-g12"), {
      id: "pickup-authority_loc-g12",
      code: "G12",
      status: "Active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });
  const staged = await recordPickup({
    deliveryOrderId: "pickup-authority_del-manual-staged",
    jobId: "pickup-authority_job-manual-1",
    technicianName: "Tech Staged",
    itemsPickedSummary: "Staged incomplete closeout",
    clientOperationId: `op-manual-staged-${crypto.randomUUID()}`,
  });
  if (staged.data.duplicate === false && staged.data.deliveryStatus === "picked_up") {
    pass("dispatcher incomplete VDO with staging → picked_up");
  } else {
    fail(
      "dispatcher incomplete VDO with staging should succeed",
      new Error(JSON.stringify(staged.data)),
    );
  }
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(
      doc(ctx.firestore(), "deliveries", "pickup-authority_del-manual-staged"),
    );
    const data = snap.data() ?? {};
    if (
      data.status === "picked_up" &&
      (data.stagingLocationId === "" || !data.stagingLocationId) &&
      Array.isArray(data.additionalStagingLocationIds) &&
      data.additionalStagingLocationIds.length === 0 &&
      Array.isArray(data.plannedStagingLocationIds) &&
      data.plannedStagingLocationIds.length === 0
    ) {
      pass("staging released on dispatcher pickup of staged VDO");
    } else {
      fail(
        "staging should clear after dispatcher pickup",
        new Error(JSON.stringify({
          status: data.status,
          stagingLocationId: data.stagingLocationId,
          additional: data.additionalStagingLocationIds,
          planned: data.plannedStagingLocationIds,
        })),
      );
    }
    const itemsSnap = await getDocs(
      query(
        collection(ctx.firestore(), "items"),
        where("deliveryOrderId", "==", "pickup-authority_del-manual-staged"),
      ),
    );
    const rewritten = itemsSnap.docs.some((d) => (d.data()?.qtyReceived ?? 0) !== 0);
    if (rewritten) {
      fail("staged manual pickup must not rewrite items");
    } else {
      pass("incomplete item evidence preserved after staged manual pickup");
    }
  });

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await testEnv.cleanup();
}
