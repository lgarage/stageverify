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

async function seedDelivery(context, status, extra = {}) {
  await setDoc(deliveryRef(context.firestore()), {
    ...BASE_DELIVERY,
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
  {
    from: "arrived",
    to: "ready_for_pickup",
    label: "submitCheckin arrived→ready_for_pickup",
    extra: { submittedAt: new Date().toISOString() },
  },
  {
    from: "partial",
    to: "ready_for_pickup",
    label: "submitCheckin partial→ready_for_pickup",
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
    from: "ready_for_pickup",
    to: "picked_up",
    label: "technician pickup ready_for_pickup→picked_up",
  },
  { from: "partial", to: "picked_up", label: "technician pickup partial→picked_up" },
  { from: "complete", to: "picked_up", label: "technician pickup complete→picked_up" },
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
        status: "picked_up",
        vendorId: "attacker-vendor",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("picked_up transition with vendorId change denied");
  } catch (err) {
    fail("picked_up transition with vendorId change should be denied", err);
  }

  try {
    await assertFails(
      updateDoc(deliveryRef(unauthed.firestore()), {
        status: "picked_up",
        jobId: "attacker-job",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("picked_up transition with jobId change denied");
  } catch (err) {
    fail("picked_up transition with jobId change should be denied", err);
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
    await assertSucceeds(
      updateDoc(deliveryRef(unauthed.firestore()), {
        stagingLocationId: "loc-g1",
        updatedAt: new Date().toISOString(),
      }),
    );
    pass("stagingLocationId-only update allowed (vendor zone pick)");
  } catch (err) {
    fail("stagingLocationId-only update should be allowed", err);
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
