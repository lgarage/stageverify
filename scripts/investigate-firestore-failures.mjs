/**
 * Root-cause investigation only — no fixes.
 * Reproduces unauthenticated vendor Firestore ops and captures exact errors.
 *
 * Usage: node scripts/investigate-firestore-failures.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  limit,
  writeBatch,
} from "firebase/firestore";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function printError(label, err) {
  console.log(`\n=== ${label} ===`);
  console.log("code:", err.code ?? "(none)");
  console.log("message:", err.message ?? String(err));
  if (err.stack) console.log("stack:", err.stack);
  if (err.customData) console.log("customData:", JSON.stringify(err.customData, null, 2));
}

async function readDoc(path) {
  const snap = await getDoc(doc(db, ...path.split("/")));
  return snap.exists() ? snap.data() : null;
}

async function testRead(collectionName, description, queryFn) {
  try {
    const snap = queryFn
      ? await queryFn()
      : await getDocs(query(collection(db, collectionName), limit(5)));
    console.log(`\n[READ OK] ${description}`);
    console.log(`  collection: ${collectionName}`);
    console.log(`  docs returned: ${snap.size ?? snap.docs?.length ?? 1}`);
    return { ok: true, size: snap.size ?? snap.docs?.length ?? 1 };
  } catch (err) {
    printError(`[READ FAIL] ${description} — collection: ${collectionName}`, err);
    return { ok: false, err };
  }
}

async function testSubmitCheckinBatch() {
  console.log("\n######## SUBMIT CHECK-IN BATCH INVESTIGATION ########");

  const delivery = await readDoc(`deliveries/${deliveryId}`);
  if (!delivery) {
    console.log("ABORT: delivery not found:", deliveryId);
    return;
  }
  console.log("Current delivery state:", {
    id: deliveryId,
    status: delivery.status,
    stagingLocationId: delivery.stagingLocationId ?? null,
    additionalStagingLocationIds: delivery.additionalStagingLocationIds ?? [],
  });

  const itemsSnap = await getDocs(
    query(
      collection(db, "items"),
      where("deliveryOrderId", "==", deliveryId),
    ),
  );
  const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(
    "Items:",
    items.map((i) => ({
      id: i.id,
      sku: i.sku,
      qtyOrdered: i.qtyOrdered,
      qtyReceived: i.qtyReceived,
      qtyMissing: i.qtyMissing,
      qtyDamaged: i.qtyDamaged,
      status: i.status,
      qtyReceivedType: typeof i.qtyReceived,
    })),
  );

  const itemUpdates = items.map((item) => ({
    id: item.id,
    qtyReceived: item.id === "item-demo-v1-1" ? 1 : item.id === "item-demo-v1-2" ? 4 : 0,
    qtyMissing:
      item.id === "item-demo-v1-1" ? 0 : item.id === "item-demo-v1-2" ? 1 : 2,
    qtyDamaged: item.id === "item-demo-v1-2" ? 1 : 0,
  }));

  const computeItemStatus = (update, qtyOrdered) => {
    if (update.qtyReceived === qtyOrdered) return "received";
    if (update.qtyReceived > 0) return "partial";
    if (update.qtyDamaged > 0) return "damaged";
    return "missing";
  };

  let allReceived = true;
  const batch = writeBatch(db);
  const itemPayloads = [];

  for (const update of itemUpdates) {
    const existing = items.find((i) => i.id === update.id);
    const qtyOrdered = existing?.qtyOrdered ?? 0;
    const status = computeItemStatus(update, qtyOrdered);
    if (update.qtyReceived !== qtyOrdered) allReceived = false;
    const payload = {
      qtyReceived: update.qtyReceived,
      qtyMissing: update.qtyMissing,
      qtyDamaged: update.qtyDamaged,
      status,
    };
    itemPayloads.push({ path: `items/${update.id}`, payload });
    batch.update(doc(db, "items", update.id), payload);
  }

  const overallStatus = allReceived ? "ready_for_pickup" : "partial";
  const now = new Date().toISOString();
  const eventId = `event-investigate-${Date.now()}`;

  const deliveryPayload = {
    status: overallStatus,
    submittedAt: now,
    updatedAt: now,
  };
  batch.update(doc(db, "deliveries", deliveryId), deliveryPayload);

  const historyPayload = {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    fromStatus: delivery.status,
    toStatus: overallStatus,
    actorType: "vendor",
    actorName: "Receiver",
    createdAt: now,
  };
  batch.set(doc(db, "statusHistory", eventId), historyPayload);

  console.log("\nBatch operations (unauthenticated):");
  for (const op of itemPayloads) {
    console.log(`  UPDATE ${op.path}`, JSON.stringify(op.payload));
  }
  console.log(`  UPDATE deliveries/${deliveryId}`, JSON.stringify(deliveryPayload));
  console.log(`  CREATE statusHistory/${eventId}`, JSON.stringify(historyPayload));

  try {
    await batch.commit();
    console.log("\n[BATCH OK] submitCheckin batch committed (investigation run)");
  } catch (err) {
    printError("BATCH FAIL submitCheckin", err);
    await testEachBatchOpIndividually(delivery, itemUpdates, items, overallStatus, now);
  }
}

async function testEachBatchOpIndividually(delivery, itemUpdates, items, overallStatus, now) {
  console.log("\n--- Isolating each batch operation ---");

  for (const update of itemUpdates) {
    const existing = items.find((i) => i.id === update.id);
    const qtyOrdered = existing?.qtyOrdered ?? 0;
    const status =
      update.qtyReceived === qtyOrdered
        ? "received"
        : update.qtyReceived > 0
          ? "partial"
          : update.qtyDamaged > 0
            ? "damaged"
            : "missing";
    const payload = {
      qtyReceived: update.qtyReceived,
      qtyMissing: update.qtyMissing,
      qtyDamaged: update.qtyDamaged,
      status,
    };
    const b = writeBatch(db);
    b.update(doc(db, "items", update.id), payload);
    try {
      await b.commit();
      console.log(`  [OK] items/${update.id}`, JSON.stringify(payload));
    } catch (err) {
      printError(`  [FAIL] items/${update.id}`, err);
      console.log("  Rejected payload:", JSON.stringify(payload));
      console.log("  Existing doc:", JSON.stringify(existing, null, 2));
    }
  }

  const deliveryPayload = {
    status: overallStatus,
    submittedAt: now,
    updatedAt: now,
  };
  const b1 = writeBatch(db);
  b1.update(doc(db, "deliveries", deliveryId), deliveryPayload);
  try {
    await b1.commit();
    console.log(`  [OK] deliveries/${deliveryId}`, JSON.stringify(deliveryPayload));
  } catch (err) {
    printError(`  [FAIL] deliveries/${deliveryId}`, err);
    console.log("  Rejected payload:", JSON.stringify(deliveryPayload));
    console.log("  Existing delivery:", JSON.stringify(delivery, null, 2));
  }

  const eventId = `event-investigate-single-${Date.now()}`;
  const historyPayload = {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    fromStatus: delivery.status,
    toStatus: overallStatus,
    actorType: "vendor",
    actorName: "Receiver",
    createdAt: now,
  };
  const b2 = writeBatch(db);
  b2.set(doc(db, "statusHistory", eventId), historyPayload);
  try {
    await b2.commit();
    console.log(`  [OK] statusHistory/${eventId}`, JSON.stringify(historyPayload));
  } catch (err) {
    printError(`  [FAIL] statusHistory/${eventId}`, err);
    console.log("  Rejected payload:", JSON.stringify(historyPayload));
  }
}

async function testNeedMoreSpaceReads() {
  console.log("\n######## NEED MORE SPACE READ INVESTIGATION ########");
  console.log("Code path: loadAndRecommend → listStagingLocations + mapOccupancyByLocationId");
  console.log("mapOccupancyByLocationId queries:");
  console.log("  1) stagingLocations — limit 500 (public read)");
  console.log("  2) deliveries — limit 500 (public read)");
  console.log("  3) vendors — limit 500 (AUTH REQUIRED per rules)");

  await testRead("stagingLocations", "listStagingLocations / fetchAllStagingLocations", () =>
    getDocs(query(collection(db, "stagingLocations"), limit(500))),
  );
  await testRead("deliveries", "mapOccupancy — fetchAll deliveries", () =>
    getDocs(query(collection(db, "deliveries"), limit(500))),
  );
  await testRead("vendors", "mapOccupancy — fetchAll vendors (SUSPECT)", () =>
    getDocs(query(collection(db, "vendors"), limit(500))),
  );
}

async function testZoneAssignBatch() {
  console.log("\n######## ZONE ASSIGN BATCH INVESTIGATION ########");
  const locationsSnap = await getDocs(
    query(collection(db, "stagingLocations"), limit(10)),
  );
  const firstLoc = locationsSnap.docs[0];
  if (!firstLoc) {
    console.log("No staging locations found");
    return;
  }
  const locationId = firstLoc.id;
  const now = new Date().toISOString();
  const eventId = `event-zone-investigate-${Date.now()}`;

  const deliveryPayload = { stagingLocationId: locationId, updatedAt: now };
  const historyPayload = {
    id: eventId,
    entityType: "delivery_order",
    entityId: deliveryId,
    fromStatus: "unassigned",
    toStatus: firstLoc.data().code ?? "G1",
    reason: "Staging location updated",
    actorType: "dispatcher",
    actorName: "Dispatcher",
    createdAt: now,
  };

  console.log("Testing zone assign WITH statusHistory (pre-fix client behavior):");
  const batchWithHistory = writeBatch(db);
  batchWithHistory.update(doc(db, "deliveries", deliveryId), deliveryPayload);
  batchWithHistory.set(doc(db, "statusHistory", eventId), historyPayload);
  console.log(`  UPDATE deliveries/${deliveryId}`, JSON.stringify(deliveryPayload));
  console.log(`  CREATE statusHistory/${eventId}`, JSON.stringify(historyPayload));
  try {
    await batchWithHistory.commit();
    console.log("  [OK] zone batch with statusHistory");
  } catch (err) {
    printError("  [FAIL] zone batch with statusHistory", err);
  }

  const eventId2 = `event-zone-investigate2-${Date.now()}`;
  console.log("\nTesting delivery-only zone assign (no statusHistory):");
  const batchDeliveryOnly = writeBatch(db);
  batchDeliveryOnly.update(doc(db, "deliveries", deliveryId), {
    stagingLocationId: locationId,
    updatedAt: new Date().toISOString(),
  });
  try {
    await batchDeliveryOnly.commit();
    console.log("  [OK] delivery-only zone update");
  } catch (err) {
    printError("  [FAIL] delivery-only zone update", err);
  }
}

async function compareRules() {
  console.log("\n######## DEPLOYED vs LOCAL RULES ########");
  const local = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
  const origin = readFileSync(resolve(process.cwd(), ".rules-origin-main.tmp"), "utf8").catch?.() ?? null;
  const localHasAdditional = local.includes("additionalStagingLocationIds");
  const localComment = local.match(/UNAUTHENTICATED WRITES[\s\S]*?AUTHENTICATED WRITES/)?.[0] ?? "";
  console.log("Local working tree additionalStagingLocationIds:", localHasAdditional);
  console.log("origin/main additionalStagingLocationIds:", origin?.includes("additionalStagingLocationIds") ?? "see git show output above");
}

(async () => {
  console.log("Firestore root-cause investigation");
  console.log("Auth state: unauthenticated (no signInWithEmailAndPassword)");
  console.log("Project: stageverify-db");
  console.log("Delivery:", deliveryId);

  await testNeedMoreSpaceReads();
  await testZoneAssignBatch();
  await testSubmitCheckinBatch();
})().catch((err) => {
  printError("FATAL", err);
  process.exit(1);
});
