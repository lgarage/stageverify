/**
 * Emulator tests for applyVendorReplyClearBackorder CF.
 * Usage:
 *   cd functions && npm run build && cd ..
 *   firebase emulators:exec --only auth,firestore,functions "node scripts/test-apply-vendor-reply-clear-backorder.mjs"
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const DISPATCHER_EMAIL = "handle-arrival-dispatcher@test.local";
const PASSWORD = "StageVerifyTest1!";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

let passed = 0;
let failed = 0;

function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig, "handle-arrival-client");
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const applyClearBackorder = httpsCallable(functions, "applyVendorReplyClearBackorder");

async function seed(setup) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setup(ctx.firestore());
  });
}

async function readDoc(path, id) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), path, id));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

console.log("\n=== applyVendorReplyClearBackorder CF ===\n");

let dispatcherUid;
try {
  const cred = await createUserWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);
  dispatcherUid = cred.user.uid;
} catch {
  await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);
  dispatcherUid = auth.currentUser.uid;
}

await seed(async (db) => {
  await setDoc(doc(db, "dispatcherRoles", dispatcherUid), {
    active: true,
    updatedAt: "2026-08-01T00:00:00Z",
  });
  await setDoc(doc(db, "appSettings", "config"), {
    vendorDeliveryMode: "full_checkin",
  });
  await setDoc(doc(db, "stagingLocations", "loc-g5"), {
    id: "loc-g5",
    code: "G5",
    label: "Bay G5",
    active: true,
  });
});

const deliveryId = "del-handle-arrival-1";
const eventId = "vee-handle-arrival-1";
const itemBoId = "item-bo-1";
const issueId = "mi-bo-1";

await seed(async (db) => {
  await setDoc(doc(db, "deliveries", deliveryId), {
    id: deliveryId,
    orderNumber: "ORD-HA-1",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "partial",
    vendorOrderComplete: true,
    openIssueCount: 1,
    openBlockingIssueCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", itemBoId), {
    id: itemBoId,
    deliveryOrderId: deliveryId,
    description: "Backordered coil",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 2,
    status: "backordered",
  });
  await setDoc(doc(db, "materialIssues", issueId), {
    id: issueId,
    deliveryOrderId: deliveryId,
    jobId: "job-1",
    type: "backordered",
    status: "open",
    blocking: true,
    description: "Coil on backorder",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "vendorEmailEvents", eventId), {
    id: eventId,
    direction: "inbound",
    reviewStatus: "pending_review",
    deliveryOrderId: deliveryId,
    subject: "Re: backorder update",
    senderEmail: "rep@vendor.com",
    receivedAt: "2026-08-01T12:00:00Z",
    createdAt: "2026-08-01T12:00:00Z",
    updatedAt: "2026-08-01T12:00:00Z",
  });
});

await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);

try {
  const result = await applyClearBackorder({
    eventId,
    action: "shop_location",
    stagingLocationId: "loc-g5",
    dispatcherApplyNote: "Vendor shipping remainder to G5",
  });
  if (result.data?.ok !== true) {
    fail("shop_location apply should return ok", JSON.stringify(result.data));
  } else {
    pass("shop_location clears backorder + assigns staging");
  }
} catch (err) {
  fail("shop_location apply should succeed", err);
}

const afterItem = await readDoc("items", itemBoId);
const afterEvent = await readDoc("vendorEmailEvents", eventId);
const afterDelivery = await readDoc("deliveries", deliveryId);
const afterIssue = await readDoc("materialIssues", issueId);

if (afterItem?.qtyBackordered === 0 && afterItem?.status === "pending") {
  pass("backorder qty cleared; status not backordered");
} else {
  fail("item backorder clear", JSON.stringify(afterItem));
}

if (afterEvent?.reviewStatus === "approved" && afterEvent?.applyAction === "shop_location") {
  pass("event marked approved with audit fields");
} else {
  fail("event audit", JSON.stringify(afterEvent));
}

if (afterDelivery?.stagingLocationId === "loc-g5" && afterIssue?.status === "resolved") {
  pass("delivery staging assigned + backorder MI resolved");
} else {
  fail("delivery/issue updates", JSON.stringify({ afterDelivery, afterIssue }));
}

try {
  await applyClearBackorder({
    eventId,
    action: "shop_location",
    stagingLocationId: "loc-g5",
  });
  fail("second apply should fail (idempotent)");
} catch (err) {
  if (String(err?.message ?? err).includes("already handled")) {
    pass("duplicate apply rejected (idempotent)");
  } else {
    fail("duplicate apply wrong error", err);
  }
}

const deliveryB = "del-handle-arrival-2";
const eventB = "vee-handle-arrival-2";
const itemB = "item-bo-2";

await seed(async (db) => {
  await setDoc(doc(db, "deliveries", deliveryB), {
    id: deliveryB,
    orderNumber: "ORD-HA-2",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "partial",
    vendorOrderComplete: true,
    stagingLocationId: "loc-g5",
    additionalStagingLocationIds: ["loc-g5"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "items", itemB), {
    id: itemB,
    deliveryOrderId: deliveryB,
    description: "Will-call part",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 1,
    status: "backordered",
  });
  await setDoc(doc(db, "vendorEmailEvents", eventB), {
    id: eventB,
    direction: "inbound",
    reviewStatus: "pending_review",
    deliveryOrderId: deliveryB,
    subject: "Ready for pickup",
    senderEmail: "rep@vendor.com",
    receivedAt: "2026-08-01T13:00:00Z",
    createdAt: "2026-08-01T13:00:00Z",
    updatedAt: "2026-08-01T13:00:00Z",
  });
});

try {
  await applyClearBackorder({
    eventId: eventB,
    action: "pickup_at_vendor",
  });
  pass("pickup_at_vendor branch succeeds");
} catch (err) {
  fail("pickup_at_vendor branch", err);
}

const deliveryAfterB = await readDoc("deliveries", deliveryB);
if (
  deliveryAfterB?.invoiceFulfillmentMethod === "will_call_pickup" &&
  deliveryAfterB?.invoiceImportStatus === "pickup_at_vendor" &&
  deliveryAfterB?.stagingLocationId === "" &&
  Array.isArray(deliveryAfterB?.additionalStagingLocationIds) &&
  deliveryAfterB.additionalStagingLocationIds.length === 0
) {
  pass("pickup_at_vendor clears staging + sets will-call fields");
} else {
  fail("pickup_at_vendor delivery patch", JSON.stringify(deliveryAfterB));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
