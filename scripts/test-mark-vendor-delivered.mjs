/**
 * markVendorDelivered CF + recalculateDeliveryReadiness auth gate (emulators).
 * Usage: npm run test:mark-vendor-delivered
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { collection, doc, getDoc, setDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const VALID_SESSION = "c".repeat(64);
const EXPIRED_SESSION = "d".repeat(64);
const WRONG_DELIVERY_SESSION = "e".repeat(64);

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

const markDelivered = httpsCallable(functions, "markVendorDelivered");
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

async function seedDelivery(db, id, extra = {}) {
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "exception_only",
  });
  await setDoc(doc(db, "deliveries", id), {
    id,
    orderNumber: "ORD-MVD",
    jobId: "job-mvd",
    vendorId: "vendor-mvd",
    purchaseOrderId: "po-mvd",
    deliveryDate: "2026-06-12",
    status: "shipped",
    stagingLocationId: "loc-mvd",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
  await setDoc(doc(db, "items", `${id}-item`), {
    id: `${id}-item`,
    deliveryOrderId: id,
    description: "Test item",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  });
}

async function seedSession(db, token, deliveryId, expiresAt) {
  await setDoc(doc(db, "vendorSessions", token), {
    id: token,
    deliveryId,
    vendorId: "vendor-mvd",
    vendorName: "Test Vendor",
    expiresAt,
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

async function readItem(id) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "items", id));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

try {
  console.log("\n=== markVendorDelivered CF ===\n");

  const deliveryId = "del-mvd-shipped";
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();

  await seed(async (db) => {
    await seedDelivery(db, deliveryId);
    await seedSession(db, VALID_SESSION, deliveryId, future);
    await seedSession(db, EXPIRED_SESSION, deliveryId, past);
    await seedSession(db, WRONG_DELIVERY_SESSION, "other-delivery", future);
  });

  try {
    await markDelivered({
      deliveryId,
      sessionToken: VALID_SESSION,
      actorName: "Test Driver",
    });
    const after = await readDelivery(deliveryId);
    const item = await readItem(`${deliveryId}-item`);
    if (
      after?.vendorPhysicalDropoffConfirmed === true &&
      after?.physicalDropoffSource === "physical_checkin" &&
      item?.qtyReceived === 1 &&
      item?.qtyMissing === 0 &&
      item?.qtyBackordered === 0
    ) {
      pass("valid session → DELIVERED writes evidence + complete-all qty");
    } else {
      fail(
        "valid session DELIVERED",
        new Error(JSON.stringify({ after, item })),
      );
    }
  } catch (err) {
    fail("valid session DELIVERED should succeed", err);
  }

  try {
    await markDelivered({
      deliveryId,
      sessionToken: VALID_SESSION,
      actorName: "Test Driver",
    });
    const after = await readDelivery(deliveryId);
    if (after?.vendorPhysicalDropoffConfirmed === true) {
      pass("idempotent duplicate DELIVERED tap succeeds");
    } else {
      fail("idempotent duplicate DELIVERED");
    }
  } catch (err) {
    fail("idempotent duplicate DELIVERED should succeed", err);
  }

  try {
    await markDelivered({ deliveryId, sessionToken: EXPIRED_SESSION });
    fail("expired session should fail");
  } catch (err) {
    if (String(err?.message ?? err).includes("Session expired")) {
      pass("expired session rejected");
    } else {
      fail("expired session wrong error", err);
    }
  }

  try {
    await markDelivered({ deliveryId, sessionToken: WRONG_DELIVERY_SESSION });
    fail("wrong-delivery session should fail");
  } catch (err) {
    if (String(err?.message ?? err).includes("not valid for this delivery")) {
      pass("wrong-delivery session rejected");
    } else {
      fail("wrong-delivery session wrong error", err);
    }
  }

  try {
    await markDelivered({ deliveryId });
    fail("missing session should fail");
  } catch (err) {
    pass("missing session rejected");
  }

  console.log("\n=== recalculateDeliveryReadiness auth gate ===\n");

  try {
    await recalculateReadiness({ deliveryOrderId: deliveryId });
    fail("unauth recalculate without session should fail");
  } catch (err) {
    pass("unauth recalculate denied without session or auth");
  }

  try {
    const result = await recalculateReadiness({
      deliveryOrderId: deliveryId,
      sessionToken: VALID_SESSION,
    });
    if (result.data?.deliveryOrderId === deliveryId) {
      pass("vendor session recalculate allowed");
    } else {
      fail("vendor session recalculate unexpected payload", new Error(JSON.stringify(result.data)));
    }
  } catch (err) {
    fail("vendor session recalculate should succeed", err);
  }

  console.log("\n=== readiness outcomes (exception_only) ===\n");

  const deliveredOnly = await recalculateReadiness({
    deliveryOrderId: deliveryId,
    sessionToken: VALID_SESSION,
  });
  if (deliveredOnly.data?.readyForPickup === false) {
    pass("DELIVERED alone ≠ Ready");
  } else {
    fail("DELIVERED alone should not be ready");
  }

  await seed(async (db) => {
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "deliveries", deliveryId), {
      vendorOrderComplete: true,
      vendorOrderCompleteAt: new Date().toISOString(),
      vendorOrderCompleteSource: "dispatcher",
    });
  });

  const bothReady = await recalculateReadiness({
    deliveryOrderId: deliveryId,
    sessionToken: VALID_SESSION,
  });
  if (
    bothReady.data?.readyForPickup === true &&
    bothReady.data?.deliveryStatus === "ready_for_pickup"
  ) {
    pass("vendor order + DELIVERED + staging → Ready");
  } else {
    fail("both sources should be ready", new Error(JSON.stringify(bothReady.data)));
  }

  await seed(async (db) => {
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "deliveries", deliveryId), {
      openBlockingIssueCount: 1,
    });
  });

  const blocked = await recalculateReadiness({
    deliveryOrderId: deliveryId,
    sessionToken: VALID_SESSION,
  });
  if (blocked.data?.readyForPickup === false) {
    pass("blocking issue prevents Ready");
  } else {
    fail("blocking issue should prevent Ready");
  }

  console.log("\n=== D-90 receiving truth (exceptions / BO preserve) ===\n");

  const delPartial = "del-mvd-partial";
  const delBO = "del-mvd-bo-seed";
  await seed(async (db) => {
    await seedDelivery(db, delPartial, { status: "pending" });
    await seedSession(db, VALID_SESSION, delPartial, future);
    await setDoc(doc(db, "items", `${delPartial}-item`), {
      id: `${delPartial}-item`,
      deliveryOrderId: delPartial,
      description: "Partial item",
      qtyOrdered: 10,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "pending",
    });

    await seedDelivery(db, delBO, { status: "pending" });
    await setDoc(doc(db, "items", `${delBO}-item`), {
      id: `${delBO}-item`,
      deliveryOrderId: delBO,
      description: "BO seeded",
      qtyOrdered: 10,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 2,
      status: "pending",
    });
  });

  // Re-bind session to partial delivery for exception mark
  await seed(async (db) => {
    await seedSession(db, VALID_SESSION, delPartial, future);
  });

  try {
    await markDelivered({
      deliveryId: delPartial,
      sessionToken: VALID_SESSION,
      actorName: "Test Driver",
      lineExceptions: [
        {
          itemId: `${delPartial}-item`,
          qtyReceived: 8,
          qtyBackordered: 2,
          qtyDamaged: 0,
        },
      ],
    });
    const item = await readItem(`${delPartial}-item`);
    if (
      item?.qtyReceived === 8 &&
      item?.qtyBackordered === 2 &&
      item?.qtyMissing === 0
    ) {
      pass("exception: 8 received + 2 BO, missing not double-counted");
    } else {
      fail("exception BO write", new Error(JSON.stringify(item)));
    }
  } catch (err) {
    fail("exception BO mark should succeed", err);
  }

  await seed(async (db) => {
    await seedSession(db, VALID_SESSION, delPartial, future);
  });

  try {
    await markDelivered({
      deliveryId: delPartial,
      sessionToken: VALID_SESSION,
      actorName: "Test Driver",
      lineExceptions: [
        {
          itemId: `${delPartial}-item`,
          qtyReceived: 8,
          qtyBackordered: 0,
          qtyDamaged: 0,
        },
      ],
    });
    const item = await readItem(`${delPartial}-item`);
    if (
      item?.qtyReceived === 8 &&
      item?.qtyBackordered === 0 &&
      item?.qtyMissing === 2
    ) {
      pass("exception: 8 received + 2 missing (no invented BO)");
    } else {
      fail("exception missing write", new Error(JSON.stringify(item)));
    }
  } catch (err) {
    fail("exception missing mark should succeed", err);
  }

  await seed(async (db) => {
    await seedSession(db, VALID_SESSION, delBO, future);
  });

  try {
    await markDelivered({
      deliveryId: delBO,
      sessionToken: VALID_SESSION,
      actorName: "Test Driver",
    });
    const item = await readItem(`${delBO}-item`);
    if (
      item?.qtyReceived === 8 &&
      item?.qtyBackordered === 2 &&
      item?.qtyMissing === 0
    ) {
      pass("complete-all preserves invoice-seeded qtyBackordered");
    } else {
      fail("BO preserve", new Error(JSON.stringify(item)));
    }
  } catch (err) {
    fail("BO preserve mark should succeed", err);
  }

  // Idempotent retry must not clobber exception qty with empty complete-all.
  await seed(async (db) => {
    await seedSession(db, VALID_SESSION, delPartial, future);
  });
  try {
    await markDelivered({
      deliveryId: delPartial,
      sessionToken: VALID_SESSION,
      actorName: "Test Driver",
    });
    const item = await readItem(`${delPartial}-item`);
    if (
      item?.qtyReceived === 8 &&
      item?.qtyBackordered === 0 &&
      item?.qtyMissing === 2
    ) {
      pass("idempotent retry does not clobber prior exception qty");
    } else {
      fail("idempotent no-clobber", new Error(JSON.stringify(item)));
    }
  } catch (err) {
    fail("idempotent no-clobber should succeed", err);
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await testEnv.cleanup();
}
