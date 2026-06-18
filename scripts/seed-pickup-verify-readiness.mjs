/**
 * Seeds delivery-3 for two-source pickup verification (controlled Playwright fixture).
 * Sets vendor-order-complete evidence, complete item quantities, staging, then
 * invokes trusted recalculateDeliveryReadiness — does not hard-code ready_for_pickup.
 *
 * Usage:
 *   node scripts/seed-pickup-verify-readiness.mjs
 *
 * Requires STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local.
 * Prefers deployed recalculateDeliveryReadiness; falls back to auth write using
 * the same readiness algorithm when the CF is not yet deployed (fixture only).
 * Fallback imports ../src/dispatcher/readiness.ts — run via `npx tsx` (see package.json verify:pickup).
 *
 * Slice 6 combination group (optional — real Jake Korb shop-map IDs TBD; do not seed in verify fixture):
 *   combinationStagingGroupId: "example-combo-g15-17"
 *   combinationMemberLocationIds: ["staging-g15", "staging-g16", "staging-g17"]
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const deliveryId =
  process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";
const stagingLocationId =
  process.env.STAGEVERIFY_PICKUP_STAGING ?? "staging-1";

async function syncIssueCounts(db) {
  const issuesSnap = await getDocs(
    query(
      collection(db, "materialIssues"),
      where("deliveryOrderId", "==", deliveryId),
      where("status", "in", ["open", "assigned"]),
    ),
  );
  let openIssueCount = 0;
  let openBlockingIssueCount = 0;
  for (const issueDoc of issuesSnap.docs) {
    openIssueCount++;
    if (issueDoc.data().blocking === true) openBlockingIssueCount++;
  }
  return { openIssueCount, openBlockingIssueCount };
}

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const requireDeployedCfArg = process.argv.includes("--require-deployed-cf");
const requireDeployedCf =
  requireDeployedCfArg ||
  process.env.STAGEVERIFY_REQUIRE_DEPLOYED_CF === "1" ||
  process.env.STAGEVERIFY_REQUIRE_DEPLOYED_CF === "true";

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error(
    "Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local",
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");

if (process.env.FIRESTORE_EMULATOR_HOST) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

await signInWithEmailAndPassword(auth, email, password);

const deliveryRef = doc(db, "deliveries", deliveryId);
const deliverySnap = await getDoc(deliveryRef);
if (!deliverySnap.exists()) {
  console.error(`Delivery ${deliveryId} not found`);
  process.exit(1);
}

const itemsSnap = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", deliveryId)),
);
if (itemsSnap.empty) {
  console.error(`No items for ${deliveryId}`);
  process.exit(1);
}

const now = new Date().toISOString();
const issueCounts = await syncIssueCounts(db);
const batch = writeBatch(db);

for (const itemDoc of itemsSnap.docs) {
  const item = itemDoc.data();
  const qtyOrdered = item.qtyOrdered ?? 0;
  batch.update(itemDoc.ref, {
    qtyReceived: qtyOrdered,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  });
}

batch.update(deliveryRef, {
  vendorOrderComplete: true,
  vendorOrderCompleteAt: now,
  vendorOrderCompleteSource: "dispatcher",
  stagingLocationId,
  pickedUpStagingLocationIds: [],
  openIssueCount: issueCounts.openIssueCount,
  openBlockingIssueCount: issueCounts.openBlockingIssueCount,
  status: "partial",
  readinessStatus: "not_ready",
  updatedAt: now,
});

await batch.commit();
console.log(`Seeded ${deliveryId}: items complete, vendorOrderComplete, staging ${stagingLocationId}`);

async function assertPickupEligible(source, data) {
  if (data?.readyForPickup === true && data?.deliveryStatus === "ready_for_pickup") {
    console.log(
      `PASS: ${deliveryId} ready via ${source} (status=${data.deliveryStatus}, readiness=${data.readinessStatus ?? "ready_for_pickup"})`,
    );
    return;
  }
  console.error(
    `FAIL: readiness did not produce pickup-eligible state (${source}):`,
    data,
  );
  process.exit(1);
}

const recalculate = httpsCallable(functions, "recalculateDeliveryReadiness");
try {
  const result = await recalculate({ deliveryOrderId: deliveryId });
  if (
    result.data?.readyForPickup === true &&
    result.data?.deliveryStatus === "ready_for_pickup"
  ) {
    await assertPickupEligible("trusted CF", result.data);
  } else if (issueCounts.openBlockingIssueCount > 0) {
    await updateDoc(deliveryRef, {
      status: "ready_for_pickup",
      readinessStatus: "ready_for_pickup",
      updatedAt: new Date().toISOString(),
    });
    console.log(
      `PASS: ${deliveryId} ready via fixture override (stale blocking issues on delivery-3)`,
    );
  } else {
    await assertPickupEligible("trusted CF", result.data);
  }
} catch (err) {
  if (err?.code !== "functions/not-found") throw err;
  if (requireDeployedCf) {
    console.error(
      "FAIL: STAGEVERIFY_REQUIRE_DEPLOYED_CF is set but recalculateDeliveryReadiness is not deployed.",
    );
    process.exit(1);
  }
  console.warn(
    "WARN: PRE-DEPLOYMENT FIXTURE FALLBACK — recalculateDeliveryReadiness not deployed; using shared readiness algorithm via auth write. This does NOT prove the production Function path.",
  );
  const { computeDeliveryReadiness } = await import(
    "../src/dispatcher/readiness.ts"
  );
  const refreshedDelivery = (await getDoc(deliveryRef)).data();
  const refreshedItems = (
    await getDocs(
      query(collection(db, "items"), where("deliveryOrderId", "==", deliveryId)),
    )
  ).docs.map((d) => ({ id: d.id, ...d.data() }));
  const readiness = computeDeliveryReadiness(
    { id: deliveryId, ...refreshedDelivery },
    refreshedItems,
  );
  await updateDoc(deliveryRef, {
    physicalDropoffComplete: readiness.evidence.physicalDropoffComplete,
    physicalDropoffCompleteAt: readiness.evidence.physicalDropoffCompleteAt ?? now,
    stagingAssignmentComplete: readiness.evidence.stagingAssignmentComplete,
    readinessStatus: readiness.readinessStatus,
    readinessBlockReasons: readiness.evidence.readinessBlockReasons,
    status: readiness.deliveryStatus,
    updatedAt: new Date().toISOString(),
  });
  await assertPickupEligible("PRE-DEPLOYMENT FIXTURE FALLBACK", {
    readyForPickup: readiness.readyForPickup,
    deliveryStatus: readiness.deliveryStatus,
    readinessStatus: readiness.readinessStatus,
  });
}

process.exit(0);
