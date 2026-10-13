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

function codeOf(err) {
  return String(err?.code ?? "");
}

function msgOf(err) {
  return String(err?.message ?? "");
}

async function seedBackorderApplyCase(db, {
  deliveryId,
  eventId,
  itemId,
  extraDelivery = {},
}) {
  await setDoc(doc(db, "deliveries", deliveryId), {
    id: deliveryId,
    orderNumber: `ORD-${deliveryId}`,
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "partial",
    vendorOrderComplete: true,
    openIssueCount: 1,
    openBlockingIssueCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extraDelivery,
  });
  await setDoc(doc(db, "items", itemId), {
    id: itemId,
    deliveryOrderId: deliveryId,
    description: "Backordered line",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 1,
    status: "backordered",
  });
  await setDoc(doc(db, "vendorEmailEvents", eventId), {
    id: eventId,
    direction: "inbound",
    reviewStatus: "pending_review",
    deliveryOrderId: deliveryId,
    subject: "Re: backorder",
    senderEmail: "rep@vendor.com",
    receivedAt: "2026-08-02T12:00:00Z",
    createdAt: "2026-08-02T12:00:00Z",
    updatedAt: "2026-08-02T12:00:00Z",
  });
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
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-happy"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-happy",
    code: "HA5",
    label: "Bay HA5",
    active: true,
  });
});

const deliveryId = "apply-vendor-reply-clear-backorder_del-handle-arrival-1";
const eventId = "apply-vendor-reply-clear-backorder_vee-handle-arrival-1";
const itemBoId = "apply-vendor-reply-clear-backorder_item-bo-1";
const issueId = "apply-vendor-reply-clear-backorder_mi-bo-1";

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
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-happy",
    dispatcherApplyNote: "Vendor shipping remainder to HA5",
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

if (afterDelivery?.stagingLocationId === "apply-vendor-reply-clear-backorder_avrcb-loc-happy" && afterIssue?.status === "resolved") {
  pass("delivery staging assigned + backorder MI resolved");
} else {
  fail("delivery/issue updates", JSON.stringify({ afterDelivery, afterIssue }));
}

try {
  await applyClearBackorder({
    eventId,
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-happy",
  });
  fail("second apply should fail (idempotent)");
} catch (err) {
  if (String(err?.message ?? err).includes("already handled")) {
    pass("duplicate apply rejected (idempotent)");
  } else {
    fail("duplicate apply wrong error", err);
  }
}

console.log("\n--- shop_location occupancy conflicts ---\n");

await seed(async (db) => {
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-primary"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-primary",
    code: "P1",
    label: "Primary conflict",
    status: "Active",
    active: true,
  });
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-addl"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-addl",
    code: "A1",
    label: "Additional conflict",
    status: "Active",
    active: true,
  });
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-planned"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-planned",
    code: "PL1",
    label: "Planned conflict",
    status: "Active",
    active: true,
  });
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-cleared"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-cleared",
    code: "CL1",
    label: "Cleared holder",
    status: "Active",
    active: true,
  });
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-self"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-self",
    code: "SL1",
    label: "Self reuse",
    status: "Active",
    active: true,
  });
  await setDoc(doc(db, "stagingLocations", "apply-vendor-reply-clear-backorder_avrcb-loc-inactive"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-loc-inactive",
    code: "IN1",
    label: "Inactive",
    status: "Inactive",
    active: false,
  });
});

// Conflict: other holds primary stagingLocationId
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-conflict-primary-a",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-conflict-primary-a",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-conflict-primary-a",
  });
  await setDoc(doc(db, "deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-conflict-primary-b"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-del-conflict-primary-b",
    orderNumber: "ORD-B",
    status: "arrived",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-primary",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-conflict-primary-a",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-primary",
  });
  fail("shop_location conflict primary should reject");
} catch (err) {
  const after = await readDoc("deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-conflict-primary-a");
  if (
    (codeOf(err).includes("failed-precondition") ||
      codeOf(err).includes("functions/failed-precondition")) &&
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") !== "apply-vendor-reply-clear-backorder_avrcb-loc-primary"
  ) {
    pass("shop_location rejected — other holds primary stagingLocationId");
  } else {
    fail("shop_location conflict primary", err);
  }
}

// Conflict: other holds additionalStagingLocationIds
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-conflict-addl-a",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-conflict-addl-a",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-conflict-addl-a",
  });
  await setDoc(doc(db, "deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-conflict-addl-b"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-del-conflict-addl-b",
    orderNumber: "ORD-B2",
    status: "arrived",
    stagingLocationId: "",
    additionalStagingLocationIds: ["apply-vendor-reply-clear-backorder_avrcb-loc-addl"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-conflict-addl-a",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-addl",
  });
  fail("shop_location conflict additional should reject");
} catch (err) {
  const after = await readDoc("deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-conflict-addl-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") !== "apply-vendor-reply-clear-backorder_avrcb-loc-addl"
  ) {
    pass("shop_location rejected — other holds additionalStagingLocationIds");
  } else {
    fail("shop_location conflict additional", err);
  }
}

// Conflict: other holds plannedStagingLocationIds only
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-conflict-planned-a",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-conflict-planned-a",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-conflict-planned-a",
  });
  await setDoc(doc(db, "deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-conflict-planned-b"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-del-conflict-planned-b",
    orderNumber: "ORD-B3",
    status: "arrived",
    stagingLocationId: "",
    plannedStagingLocationIds: ["apply-vendor-reply-clear-backorder_avrcb-loc-planned"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-conflict-planned-a",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-planned",
  });
  fail("shop_location conflict planned should reject");
} catch (err) {
  const after = await readDoc("deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-conflict-planned-a");
  if (
    /no longer available/i.test(msgOf(err)) &&
    (after?.stagingLocationId ?? "") !== "apply-vendor-reply-clear-backorder_avrcb-loc-planned"
  ) {
    pass("shop_location rejected — other holds plannedStagingLocationIds only");
  } else {
    fail("shop_location conflict planned", err);
  }
}

// ZONE_CLEARED — picked_up holder ignored
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-cleared-a",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-cleared-a",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-cleared-a",
  });
  await setDoc(doc(db, "deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-cleared-b"), {
    id: "apply-vendor-reply-clear-backorder_avrcb-del-cleared-b",
    orderNumber: "ORD-CL",
    status: "picked_up",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-cleared",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-cleared-a",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-cleared",
  });
  const after = await readDoc("deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-cleared-a");
  if (after?.stagingLocationId === "apply-vendor-reply-clear-backorder_avrcb-loc-cleared") {
    pass("shop_location succeeds over picked_up holder (ZONE_CLEARED)");
  } else {
    fail("shop_location ZONE_CLEARED", JSON.stringify(after));
  }
} catch (err) {
  fail("shop_location ZONE_CLEARED", err);
}

// Same delivery already uses spot
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-self-reuse",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-self-reuse",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-self-reuse",
    extraDelivery: {
      stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-self",
      additionalStagingLocationIds: ["apply-vendor-reply-clear-backorder_avrcb-loc-self"],
    },
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-self-reuse",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-self",
  });
  const after = await readDoc("deliveries", "apply-vendor-reply-clear-backorder_avrcb-del-self-reuse");
  if (after?.stagingLocationId === "apply-vendor-reply-clear-backorder_avrcb-loc-self") {
    pass("shop_location succeeds when delivery already uses spot");
  } else {
    fail("shop_location self reuse", JSON.stringify(after));
  }
} catch (err) {
  fail("shop_location self reuse", err);
}

// Inactive location
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-inactive-loc",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-inactive-loc",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-inactive-loc",
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-inactive-loc",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-inactive",
  });
  fail("shop_location inactive loc should reject");
} catch (err) {
  if (/no longer available/i.test(msgOf(err))) {
    pass("shop_location rejected — inactive location");
  } else {
    fail("shop_location inactive loc", err);
  }
}

// Missing location
await seed(async (db) => {
  await seedBackorderApplyCase(db, {
    deliveryId: "apply-vendor-reply-clear-backorder_avrcb-del-missing-loc",
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-missing-loc",
    itemId: "apply-vendor-reply-clear-backorder_avrcb-item-missing-loc",
  });
});
try {
  await applyClearBackorder({
    eventId: "apply-vendor-reply-clear-backorder_avrcb-evt-missing-loc",
    action: "shop_location",
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-missing-xyz",
  });
  fail("shop_location missing loc should reject");
} catch (err) {
  if (codeOf(err).includes("not-found") || /not found/i.test(msgOf(err))) {
    pass("shop_location rejected — missing location");
  } else {
    fail("shop_location missing loc", err);
  }
}

const deliveryB = "apply-vendor-reply-clear-backorder_del-handle-arrival-2";
const eventB = "apply-vendor-reply-clear-backorder_vee-handle-arrival-2";
const itemB = "apply-vendor-reply-clear-backorder_item-bo-2";

await seed(async (db) => {
  await setDoc(doc(db, "deliveries", deliveryB), {
    id: deliveryB,
    orderNumber: "ORD-HA-2",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "partial",
    vendorOrderComplete: true,
    stagingLocationId: "apply-vendor-reply-clear-backorder_avrcb-loc-happy",
    additionalStagingLocationIds: ["apply-vendor-reply-clear-backorder_avrcb-loc-happy"],
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
