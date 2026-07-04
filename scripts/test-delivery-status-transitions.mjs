/**
 * Firestore security rules — delivery status transition allowlist.
 * Runs against the local Firestore emulator (no production writes).
 *
 * Usage: npm run test:firestore-rules
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "stageverify-rules-test";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const BASE_DELIVERY = {
  id: "test-delivery",
  jobId: "job-test",
  vendorId: "vendor-test",
  orderNumber: "ORD-TEST",
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function deliveryRef(db, id = "test-delivery") {
  return doc(db, "deliveries", id);
}

async function seedDelivery(context, status, extra = {}, id = "test-delivery") {
  await setDoc(deliveryRef(context.firestore(), id), {
    ...BASE_DELIVERY,
    id,
    status,
    ...extra,
  });
}

async function unauthStatusUpdate(unauthedDb, deliveryId, status, extra = {}) {
  return updateDoc(deliveryRef(unauthedDb, deliveryId), {
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

/** @type {{ from: string, to: string, label: string, extra?: Record<string, unknown> }[]} */
const ALLOWED = [
  { from: "pending", to: "arrived", label: "vendor scan pending→arrived" },
  { from: "shipped", to: "arrived", label: "vendor DELIVERED shipped→arrived" },
  {
    from: "arrived",
    to: "partial",
    label: "submitCheckin arrived→partial",
    extra: { submittedAt: new Date().toISOString() },
  },
  { from: "partial", to: "arrived", label: "vendor revert partial→arrived" },
  {
    from: "ready_for_pickup",
    to: "arrived",
    label: "vendor revert ready_for_pickup→arrived",
  },
  {
    from: "complete",
    to: "arrived",
    label: "vendor revert complete→arrived",
  },
  {
    from: "arrived",
    to: "arrived",
    label: "idempotent arrived→arrived (markVendorDelivered)",
    extra: { submittedAt: new Date().toISOString() },
  },
];

/** @type {{ from: string, to: string, label: string }[]} */
const FORBIDDEN = [
  { from: "picked_up", to: "partial", label: "regression picked_up→partial" },
  { from: "picked_up", to: "pending", label: "regression picked_up→pending" },
  { from: "picked_up", to: "ready_for_pickup", label: "regression picked_up→ready_for_pickup" },
  { from: "installed", to: "picked_up", label: "regression installed→picked_up" },
  { from: "ready_for_pickup", to: "partial", label: "regression ready_for_pickup→partial" },
  { from: "ready_for_pickup", to: "pending", label: "regression ready_for_pickup→pending" },
  { from: "partial", to: "pending", label: "regression partial→pending" },
  { from: "arrived", to: "pending", label: "regression arrived→pending" },
  { from: "arrived", to: "picked_up", label: "skip arrived→picked_up" },
  { from: "pending", to: "picked_up", label: "skip pending→picked_up" },
  { from: "pending", to: "partial", label: "skip pending→partial" },
  { from: "issue", to: "arrived", label: "unauth issue→arrived (dispatcher-only)" },
  { from: "partial", to: "issue", label: "unauth partial→issue" },
  { from: "partial", to: "picked_up", label: "authority partial→picked_up" },
  { from: "ready_for_pickup", to: "picked_up", label: "authority ready_for_pickup→picked_up" },
  { from: "complete", to: "picked_up", label: "authority complete→picked_up" },
  { from: "arrived", to: "ready_for_pickup", label: "authority arrived→ready_for_pickup" },
  { from: "partial", to: "ready_for_pickup", label: "authority partial→ready_for_pickup" },
];

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err.message ?? err}`);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

try {
  console.log("\n=== Allowed unauthenticated delivery status transitions ===\n");
  for (const tc of ALLOWED) {
    const deliveryId = `allow-${tc.from}-${tc.to}`;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(deliveryRef(ctx.firestore(), deliveryId), {
        ...BASE_DELIVERY,
        id: deliveryId,
        status: tc.from,
      });
    });
    const unauthed = testEnv.unauthenticatedContext();
    try {
      await assertSucceeds(
        unauthStatusUpdate(unauthed.firestore(), deliveryId, tc.to, tc.extra ?? {}),
      );
      pass(`${tc.label} (${tc.from} → ${tc.to})`);
    } catch (err) {
      fail(`${tc.label} (${tc.from} → ${tc.to})`, err);
    }
  }

  console.log("\n=== Forbidden unauthenticated delivery status transitions ===\n");
  for (const tc of FORBIDDEN) {
    const deliveryId = `deny-${tc.from}-${tc.to}`;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(deliveryRef(ctx.firestore(), deliveryId), {
        ...BASE_DELIVERY,
        id: deliveryId,
        status: tc.from,
      });
    });
    const unauthed = testEnv.unauthenticatedContext();
    try {
      await assertFails(
        unauthStatusUpdate(unauthed.firestore(), deliveryId, tc.to),
      );
      pass(`${tc.label} (${tc.from} → ${tc.to}) permission-denied`);
    } catch (err) {
      fail(`${tc.label} (${tc.from} → ${tc.to}) should be denied`, err);
    }
  }

  console.log("\n=== Field-level restrictions (valid transition + forbidden field) ===\n");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await seedDelivery(ctx, "partial");
  });
  const unauthed = testEnv.unauthenticatedContext();
  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        vendorId: "attacker-vendor",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("partial update with vendorId change denied");
  } catch (err) {
    fail("partial update with vendorId change should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        jobId: "attacker-job",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("partial update with jobId change denied");
  } catch (err) {
    fail("partial update with jobId change should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        vendorOrderComplete: true,
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("vendorOrderComplete write denied");
  } catch (err) {
    fail("vendorOrderComplete write should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        readinessStatus: "ready_for_pickup",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("readinessStatus forgery denied");
  } catch (err) {
    fail("readinessStatus forgery should be denied", err);
  }

  console.log("\n=== Non-status unauthenticated delivery updates ===\n");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await seedDelivery(ctx, "partial");
  });
  try {
    await assertSucceeds(
      updateDoc(deliveryRef(unauthed.firestore()), {
        lastCheckmarkAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("lastCheckmarkAt-only update allowed (vendor item check-off)");
  } catch (err) {
    fail("lastCheckmarkAt-only update should be allowed", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        stagingLocationId: "loc-g1",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("stagingLocationId-only update denied (vendor CF required)");
  } catch (err) {
    fail("stagingLocationId-only update should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        additionalStagingLocationIds: ["loc-g2"],
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("additionalStagingLocationIds update denied (vendor CF required)");
  } catch (err) {
    fail("additionalStagingLocationIds update should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore(), "test-delivery"), {
        status: "arrived",
        vendorPhysicalDropoffConfirmed: true,
        vendorPhysicalDropoffConfirmedAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        physicalDropoffSource: "physical_checkin",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("vendor physical drop-off evidence forgery denied (CF-only)");
  } catch (err) {
    fail("vendor physical drop-off evidence forgery should be denied", err);
  }

  try {
    await assertSucceeds(
      updateDoc(deliveryRef(unauthed.firestore(), "test-delivery"), {
        status: "arrived",
        vendorPhysicalDropoffConfirmed: false,
        vendorPhysicalDropoffConfirmedAt: null,
        deliveredAt: null,
        physicalDropoffSource: null,
        submittedAt: null,
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("vendor revert may clear physical evidence (false/null only)");
  } catch (err) {
    fail("vendor revert evidence clear should be allowed", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        physicalDropoffComplete: true,
        physicalDropoffCompleteAt: new Date().toISOString(),
        stagingAssignmentComplete: true,
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("derived physicalDropoffComplete write denied");
  } catch (err) {
    fail("derived physicalDropoffComplete write should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        physicalDropoffCompleteAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("derived physicalDropoffCompleteAt write denied");
  } catch (err) {
    fail("derived physicalDropoffCompleteAt write should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "partial",
        stagingAssignmentComplete: true,
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("derived stagingAssignmentComplete write denied");
  } catch (err) {
    fail("derived stagingAssignmentComplete write should be denied", err);
  }

  console.log("\n=== Collection write restrictions ===\n");
  try {
    await assertFails(
      setDoc(doc(unauthed.firestore(), "pickupEvents", "evt-1"), {
        id: "evt-1",
        deliveryOrderId: "test-delivery",
        jobId: "job-test",
        technicianName: "Attacker",
        pickedUpAt: new Date().toISOString(),
        itemsPickedSummary: "forged",
      }),
    );
    pass("pickupEvents create denied");
  } catch (err) {
    fail("pickupEvents create should be denied", err);
  }

  try {
    await assertFails(
      setDoc(doc(unauthed.firestore(), "pickupOperations", "op-1"), {
        deliveryOrderId: "test-delivery",
        jobId: "job-test",
      }),
    );
    pass("pickupOperations create denied");
  } catch (err) {
    fail("pickupOperations create should be denied", err);
  }

  console.log("\n=== Forged statusHistory transitions ===\n");
  try {
    await assertFails(
      setDoc(doc(unauthed.firestore(), "statusHistory", "hist-picked"), {
        id: "hist-picked",
        entityType: "delivery_order",
        entityId: "test-delivery",
        toStatus: "picked_up",
        actorType: "technician",
        actorName: "Attacker",
        createdAt: new Date().toISOString(),
      }),
    );
    pass("forged picked_up history denied");
  } catch (err) {
    fail("forged picked_up history should be denied", err);
  }

  try {
    await assertFails(
      setDoc(doc(unauthed.firestore(), "statusHistory", "hist-ready"), {
        id: "hist-ready",
        entityType: "delivery_order",
        entityId: "test-delivery",
        toStatus: "ready_for_pickup",
        actorType: "vendor",
        actorName: "Attacker",
        createdAt: new Date().toISOString(),
      }),
    );
    pass("forged ready_for_pickup history denied");
  } catch (err) {
    fail("forged ready_for_pickup history should be denied", err);
  }

  try {
    await assertSucceeds(
      setDoc(doc(unauthed.firestore(), "statusHistory", "hist-arrived"), {
        id: "hist-arrived",
        entityType: "delivery_order",
        entityId: "test-delivery",
        toStatus: "arrived",
        actorType: "vendor",
        actorName: "Vendor Driver",
        createdAt: new Date().toISOString(),
      }),
    );
    pass("vendor arrived history allowed");
  } catch (err) {
    fail("vendor arrived history should be allowed", err);
  }

  console.log("\n=== Invalid status values ===\n");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await seedDelivery(ctx, "partial");
  });
  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "hacked",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("invalid status value denied");
  } catch (err) {
    fail("invalid status value should be denied", err);
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
} finally {
  await testEnv.cleanup();
}
