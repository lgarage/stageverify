/**
 * Auto-submit + shared readiness integration tests (Firestore + Functions emulators).
 * Run: npm run test:auto-submit-readiness
 */

import { readFileSync } from "fs";
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
const recalculateReadiness = httpsCallable(functions, "recalculateDeliveryReadiness");

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

async function countHistory() {
  let total = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), "statusHistory"));
    total = snap.size;
  });
  return total;
}

async function simulateAutoSubmitAndRecalculate(deliveryId, fromStatus = "arrived") {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = new Date().toISOString();
    await setDoc(
      doc(db, "deliveries", deliveryId),
      {
        status: "partial",
        submittedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    if (fromStatus !== "partial") {
      await setDoc(doc(db, "statusHistory", `event-auto-${deliveryId}`), {
        id: `event-auto-${deliveryId}`,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus,
        toStatus: "partial",
        reason: "Auto-submitted after inactivity timeout",
        actorType: "system",
        actorName: "Auto-Submit",
        createdAt: now,
      });
    }
  });
  return recalculateReadiness({ deliveryOrderId: deliveryId });
}

console.log("\n=== Auto-submit readiness integration ===\n");

// 1. Physical evidence only — not ready
await seed(async (db) => {
  await setDoc(doc(db, "deliveries", "auto-phys-only"), {
    id: "auto-phys-only",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "arrived",
    stagingLocationId: "loc-a",
    vendorOrderComplete: false,
    lastCheckmarkAt: "2020-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "item-phys-1"), {
    deliveryOrderId: "auto-phys-only",
    qtyOrdered: 2,
    qtyReceived: 2,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
  });
});
try {
  const result = await simulateAutoSubmitAndRecalculate("auto-phys-only");
  if (
    result.data.readyForPickup === false &&
    result.data.deliveryStatus !== "ready_for_pickup"
  ) {
    pass("physical only remains not ready after auto-submit path");
  } else {
    fail("physical only should not become ready", result.data);
  }
} catch (err) {
  fail("physical only test", err);
}

// 2. Both sources + staging → ready
await seed(async (db) => {
  await setDoc(doc(db, "deliveries", "auto-ready"), {
    id: "auto-ready",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "arrived",
    stagingLocationId: "loc-a",
    vendorOrderComplete: true,
    vendorOrderCompleteAt: new Date().toISOString(),
    vendorOrderCompleteSource: "dispatcher",
    lastCheckmarkAt: "2020-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "item-ready-1"), {
    deliveryOrderId: "auto-ready",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
  });
});
try {
  const result = await simulateAutoSubmitAndRecalculate("auto-ready");
  if (
    result.data.readyForPickup === true &&
    result.data.deliveryStatus === "ready_for_pickup"
  ) {
    pass("vendor complete + physical + staging may become ready");
  } else {
    fail("both sources should become ready", result.data);
  }
} catch (err) {
  fail("both sources ready test", err);
}

// 3. Missing staging blocks
await seed(async (db) => {
  await setDoc(doc(db, "deliveries", "auto-no-staging"), {
    id: "auto-no-staging",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "arrived",
    stagingLocationId: "",
    vendorOrderComplete: true,
    lastCheckmarkAt: "2020-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "item-nostage-1"), {
    deliveryOrderId: "auto-no-staging",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
  });
});
try {
  const result = await simulateAutoSubmitAndRecalculate("auto-no-staging");
  if (result.data.readyForPickup === false) {
    pass("missing staging blocks readiness");
  } else {
    fail("missing staging should block", result.data);
  }
} catch (err) {
  fail("missing staging test", err);
}

// 4. Damage blocks
await seed(async (db) => {
  await setDoc(doc(db, "deliveries", "auto-damage"), {
    id: "auto-damage",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "arrived",
    stagingLocationId: "loc-a",
    vendorOrderComplete: true,
    lastCheckmarkAt: "2020-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", "item-dmg-1"), {
    deliveryOrderId: "auto-damage",
    qtyOrdered: 2,
    qtyReceived: 2,
    qtyMissing: 0,
    qtyDamaged: 1,
    qtyBackordered: 0,
  });
});
try {
  const result = await simulateAutoSubmitAndRecalculate("auto-damage");
  if (result.data.readyForPickup === false) {
    pass("damage blocks readiness");
  } else {
    fail("damage should block", result.data);
  }
} catch (err) {
  fail("damage test", err);
}

// 5. Repeated processing — no duplicate history
await seed(async (db) => {
  await setDoc(doc(db, "deliveries", "auto-idempotent"), {
    id: "auto-idempotent",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "ready_for_pickup",
    stagingLocationId: "loc-a",
    vendorOrderComplete: true,
    readinessStatus: "ready_for_pickup",
    lastCheckmarkAt: "2020-01-01T00:00:00Z",
    submittedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, "items", "item-idem-1"), {
    deliveryOrderId: "auto-idempotent",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
  });
});
try {
  const before = await countHistory();
  await recalculateReadiness({ deliveryOrderId: "auto-idempotent" });
  await recalculateReadiness({ deliveryOrderId: "auto-idempotent" });
  const after = await countHistory();
  if (after === before) {
    pass("repeated recalculation does not duplicate history");
  } else {
    fail(`history grew from ${before} to ${after}`);
  }
} catch (err) {
  fail("idempotent history test", err);
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
