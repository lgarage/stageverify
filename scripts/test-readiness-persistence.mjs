/**
 * Readiness persistence wiring — staging recalc + blocking issue demotion (emulators).
 * Usage: npm run test:readiness-persistence
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { recalcPayload, seedVendorSession } from "./test-vendor-session-helper.mjs";

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

const recalculateReadiness = httpsCallable(functions, "recalculateDeliveryReadiness");
const createMaterialIssue = httpsCallable(functions, "createMaterialIssue");

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

async function seedReadyExceptStaging(db, deliveryId) {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "full_checkin",
  });
  await setDoc(doc(db, "jobs", "job-rp"), {
    id: "job-rp",
    jobNumber: "JOB-RP",
    customerName: "Test",
    materialOwnerId: "owner-1",
    materialOwnerName: "Owner",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "deliveries", deliveryId), {
    id: deliveryId,
    orderNumber: "ORD-RP-STAGE",
    jobId: "job-rp",
    vendorId: "vendor-rp",
    purchaseOrderId: "po-rp",
    deliveryDate: "2026-06-12",
    status: "partial",
    vendorOrderComplete: true,
    stagingLocationId: "",
    openIssueCount: 0,
    openBlockingIssueCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", `${deliveryId}-item`), {
    id: `${deliveryId}-item`,
    deliveryOrderId: deliveryId,
    description: "Coil",
    qtyOrdered: 2,
    qtyReceived: 2,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  });
  await seedVendorSession(db, deliveryId);
}

async function seedReadyForPickup(db, deliveryId) {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "full_checkin",
  });
  await setDoc(doc(db, "jobs", "job-rp"), {
    id: "job-rp",
    jobNumber: "JOB-RP",
    customerName: "Test",
    materialOwnerId: "owner-1",
    materialOwnerName: "Owner",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "deliveries", deliveryId), {
    id: deliveryId,
    orderNumber: "ORD-RP-ISSUE",
    jobId: "job-rp",
    vendorId: "vendor-rp",
    purchaseOrderId: "po-rp",
    deliveryDate: "2026-06-12",
    status: "ready_for_pickup",
    vendorOrderComplete: true,
    stagingLocationId: "loc-g2",
    stagingAssignmentComplete: true,
    physicalDropoffComplete: true,
    readinessStatus: "ready_for_pickup",
    openIssueCount: 0,
    openBlockingIssueCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", `${deliveryId}-item`), {
    id: `${deliveryId}-item`,
    deliveryOrderId: deliveryId,
    description: "Coil",
    qtyOrdered: 2,
    qtyReceived: 2,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  });
}

try {
  console.log("\n=== Staging assignment → recalc promotes ready_for_pickup ===\n");

  const stagingId = "del-rp-staging";
  await seed(async (db) => seedReadyExceptStaging(db, stagingId));

  const beforeStaging = await recalculateReadiness(recalcPayload(stagingId));
  if (beforeStaging.data?.readyForPickup !== false) {
    fail("delivery without staging is not ready before assignment");
  } else {
    pass("delivery without staging is not ready before assignment");
  }

  await seed(async (db) => {
    await updateDoc(doc(db, "deliveries", stagingId), {
      stagingLocationId: "loc-g2",
      updatedAt: new Date().toISOString(),
    });
  });

  const afterStaging = await recalculateReadiness(recalcPayload(stagingId));
  const stagedDoc = await readDelivery(stagingId);

  if (afterStaging.data?.readyForPickup === true) {
    pass("recalculateDeliveryReadiness returns ready after staging assigned");
  } else {
    fail("recalculateDeliveryReadiness returns ready after staging assigned");
  }
  if (stagedDoc?.status === "ready_for_pickup") {
    pass("persisted delivery.status is ready_for_pickup after staging recalc");
  } else {
    fail(
      `persisted delivery.status is ready_for_pickup after staging recalc (got ${stagedDoc?.status})`,
    );
  }

  console.log("\n=== Blocking issue demotes ready_for_pickup ===\n");

  const issueId = "del-rp-blocking";
  await seed(async (db) => seedReadyForPickup(db, issueId));

  const createResult = await createMaterialIssue({
    deliveryOrderId: issueId,
    jobId: "job-rp",
    type: "missing",
    description: "Missing coil",
    reportedBy: "Technician",
    clientRequestId: `req-${Date.now()}-blocking`,
  });

  if (createResult.data?.blocking === true) {
    pass("createMaterialIssue reports blocking for missing type");
  } else {
    fail("createMaterialIssue reports blocking for missing type");
  }

  const afterIssue = await readDelivery(issueId);
  if (afterIssue?.status !== "ready_for_pickup") {
    pass("ready_for_pickup demoted after blocking issue");
  } else {
    fail("ready_for_pickup demoted after blocking issue");
  }
  if ((afterIssue?.openBlockingIssueCount ?? 0) >= 1) {
    pass("openBlockingIssueCount incremented on delivery");
  } else {
    fail("openBlockingIssueCount incremented on delivery");
  }

  console.log("\n=== Non-blocking issue leaves readiness unchanged ===\n");

  const nonBlockId = "del-rp-nonblock";
  await seed(async (db) => seedReadyForPickup(db, nonBlockId));

  await createMaterialIssue({
    deliveryOrderId: nonBlockId,
    jobId: "job-rp",
    type: "other",
    description: "FYI note",
    reportedBy: "Technician",
    clientRequestId: `req-${Date.now()}-other`,
  });

  const afterNonBlock = await readDelivery(nonBlockId);
  if (afterNonBlock?.status === "ready_for_pickup") {
    pass("non-blocking issue leaves ready_for_pickup status");
  } else {
    fail(
      `non-blocking issue leaves ready_for_pickup status (got ${afterNonBlock?.status})`,
    );
  }
} catch (err) {
  fail("unexpected test error", err);
} finally {
  await testEnv.cleanup();
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
