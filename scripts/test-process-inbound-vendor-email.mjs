/**
 * Phase 5 vendor email write path — authenticated CF callable smoke (emulators).
 * Proves processInboundVendorEmail end-to-end; admin SDK is not used for auto-apply assertions.
 *
 * Usage: npm run test:process-inbound-vendor-email
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { hasVendorOrderCompleteApplyConflict } from "../src/dispatcher/email/emailApplyConflicts.ts";
import { buildVendorOrderCompletePatch } from "../src/dispatcher/email/processEmailMessage.ts";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const TEST_EMAIL =
  process.env.STAGEVERIFY_TEST_EMAIL ?? "dispatcher-test@stageverify.test";
const TEST_PASSWORD =
  process.env.STAGEVERIFY_TEST_PASSWORD ?? "StageVerifyTest1!";

const COMPLETE_EMAIL = {
  sourceMessageId: "msg-vendor-complete-test-001",
  threadId: "thread-test",
  senderEmail: "dispatch@johnstone.com",
  recipientEmails: ["monitor@configured-inbox.example"],
  subject: "Order complete PO-45821",
  bodyText:
    "All items on PO-45821 ORD-1007 for job 26-1042 have shipped. No remaining items. Order complete.",
  receivedAt: "2026-06-11T16:00:00Z",
};

const COMPLETE_EMAIL_RECALC = {
  sourceMessageId: "msg-vendor-complete-recalc-001",
  threadId: "thread-recalc",
  senderEmail: "dispatch@johnstone.com",
  recipientEmails: ["monitor@configured-inbox.example"],
  subject: "Order complete PO-45821 ORD-1008",
  bodyText:
    "All items on PO-45821 ORD-1008 for job 26-1042 have shipped. No remaining items. Order complete.",
  receivedAt: "2026-06-11T16:30:00Z",
};

const CONFLICT_EMAIL = {
  sourceMessageId: "msg-vendor-complete-conflict-001",
  threadId: "thread-conflict",
  senderEmail: "dispatch@johnstone.com",
  recipientEmails: ["monitor@configured-inbox.example"],
  subject: "Order complete PO-45821 ORD-1009",
  bodyText:
    "All items on PO-45821 ORD-1009 for job 26-1042 have shipped. No remaining items. Order complete.",
  receivedAt: "2026-06-11T16:45:00Z",
};

const LOW_CONFIDENCE_EMAIL = {
  sourceMessageId: "msg-ambiguous-test-001",
  senderEmail: "dispatch@johnstone.com",
  recipientEmails: ["monitor@configured-inbox.example"],
  subject: "Shipment update",
  bodyText: "Your material shipped today.",
  receivedAt: "2026-06-11T17:00:00Z",
};

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

console.log("\n=== Unit: conflict + patch shape (offline) ===\n");

const patch = buildVendorOrderCompletePatch("2026-06-11T16:00:00Z", 95);
if (
  patch.vendorOrderComplete === true &&
  patch.vendorOrderCompleteSource === "vendor_email" &&
  !("status" in patch) &&
  !("readinessStatus" in patch) &&
  !("physicalDropoffComplete" in patch)
) {
  pass("buildVendorOrderCompletePatch sets Condition 1 only");
} else {
  fail("buildVendorOrderCompletePatch must not set readiness/status/physical fields", patch);
}

const conflictBackorder = hasVendorOrderCompleteApplyConflict(
  { vendorPhysicalDropoffConfirmed: false },
  [{ qtyOrdered: 10, qtyReceived: 10, qtyMissing: 0, qtyDamaged: 0, qtyBackordered: 2 }],
  {
    classification: "vendor_order_complete",
    poNumbers: [],
    orderNumbers: [],
    jobNumbers: [],
    itemLines: [],
    vendorOrderCompleteClaim: true,
  },
);
if (conflictBackorder === "unresolved_backorder_on_items") {
  pass("backorder blocks auto-apply (offline)");
} else {
  fail("expected backorder conflict", conflictBackorder);
}

const conflictPhysical = hasVendorOrderCompleteApplyConflict(
  { vendorPhysicalDropoffConfirmed: true },
  [{ qtyOrdered: 10, qtyReceived: 5, qtyMissing: 0, qtyDamaged: 0, qtyBackordered: 0 }],
  {
    classification: "vendor_order_complete",
    poNumbers: [],
    orderNumbers: [],
    jobNumbers: [],
    itemLines: [],
    vendorOrderCompleteClaim: true,
  },
);
if (conflictPhysical === "conflicting_physical_evidence") {
  pass("physical vs email complete blocks auto-apply (offline)");
} else {
  fail("expected physical conflict", conflictPhysical);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp(firebaseConfig);
const db = getFirestore(clientApp);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const processEmail = httpsCallable(functions, "processInboundVendorEmail");

async function readDoc(path) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), ...path));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

async function seedBase() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, "appSettings", "config"), {
      vendorDeliveryMode: "exception_only",
    });
    await setDoc(doc(adminDb, "vendors", "vendor-johnstone"), {
      id: "vendor-johnstone",
      name: "Johnstone Supply",
      email: "dispatch@johnstone.com",
      createdAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "jobs", "job-261042"), {
      id: "job-261042",
      jobNumber: "26-1042",
      jobName: "Email write test",
      status: "active",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "purchaseOrders", "po-johnstone-45821"), {
      id: "po-johnstone-45821",
      poNumber: "PO-45821",
      jobId: "job-261042",
      vendorId: "vendor-johnstone",
      status: "open",
    });
  });
}

async function seedDelivery({
  deliveryId,
  orderNumber,
  itemId,
  itemOverrides = {},
  deliveryOverrides = {},
}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, "deliveries", deliveryId), {
      id: deliveryId,
      orderNumber,
      jobId: "job-261042",
      vendorId: "vendor-johnstone",
      purchaseOrderId: "po-johnstone-45821",
      status: "partial",
      stagingLocationId: "loc-g2",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      ...deliveryOverrides,
    });
    await setDoc(doc(adminDb, "items", itemId), {
      id: itemId,
      deliveryOrderId: deliveryId,
      jobId: "job-261042",
      description: "Duct section",
      qtyOrdered: 4,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "pending",
      ...itemOverrides,
    });
  });
}

async function ensureSignedIn() {
  try {
    await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
  } catch {
    await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
  }
  if (!auth.currentUser?.uid) {
    throw new Error("Auth emulator sign-in failed");
  }
}

console.log("\n=== CF: auth gate (emulators) ===\n");

try {
  await processEmail({ message: COMPLETE_EMAIL });
  fail("unauthenticated processInboundVendorEmail should be denied");
} catch (err) {
  const code = err?.code ?? err?.details?.code;
  if (String(code).includes("permission-denied") || String(err?.message).includes("permission")) {
    pass("unauthenticated call denied");
  } else {
    fail("expected permission-denied", err);
  }
}

await seedBase();

console.log("\n=== CF: authenticated auto-apply path ===\n");

await seedDelivery({
  deliveryId: "del-email-write-test",
  orderNumber: "ORD-1007",
  itemId: "item-email-write-test",
});

await ensureSignedIn();
pass(`dispatcher signed in (${TEST_EMAIL})`);

let autoApplyResult;
try {
  autoApplyResult = await processEmail({ message: COMPLETE_EMAIL });
} catch (err) {
  fail("authenticated high-confidence auto-apply should succeed", err);
}

const autoData = autoApplyResult?.data ?? {};
if (autoData.autoApplied === true && autoData.reviewStatus === "auto_processed") {
  pass("CF returned autoApplied: true");
} else {
  fail("expected autoApplied true", autoData);
}

if (autoData.deliveryOrderId === "del-email-write-test") {
  pass("CF matched target delivery");
} else {
  fail("unexpected deliveryOrderId", autoData);
}

const eventDoc = autoData.eventId
  ? await readDoc(["vendorEmailEvents", autoData.eventId])
  : null;
if (eventDoc?.reviewStatus === "auto_processed" && eventDoc?.deliveryOrderId === "del-email-write-test") {
  pass("vendorEmailEvents audit row written");
} else {
  fail("vendorEmailEvents missing or wrong shape", eventDoc);
}

const deliveryAfterApply = await readDoc(["deliveries", "del-email-write-test"]);
if (
  deliveryAfterApply?.vendorOrderComplete === true &&
  deliveryAfterApply?.vendorOrderCompleteSource === "vendor_email" &&
  typeof deliveryAfterApply?.vendorOrderCompleteConfidence === "number"
) {
  pass("delivery Condition 1 fields set via CF");
} else {
  fail("delivery Condition 1 patch missing", deliveryAfterApply);
}

if (
  deliveryAfterApply?.status !== "ready_for_pickup" &&
  deliveryAfterApply?.readinessStatus !== "ready_for_pickup" &&
  autoData.readyForPickup !== true
) {
  pass("email alone did not set Ready for Pickup");
} else {
  fail("ready_for_pickup must not be set by email path alone", {
    doc: deliveryAfterApply,
    response: autoData,
  });
}

console.log("\n=== CF: physical + staging recalc can set ready ===\n");

await seedDelivery({
  deliveryId: "del-email-ready-recalc",
  orderNumber: "ORD-1008",
  itemId: "item-ready-recalc",
  itemOverrides: {
    qtyReceived: 4,
    status: "received",
  },
  deliveryOverrides: {
    vendorPhysicalDropoffConfirmed: true,
    physicalDropoffSource: "physical_checkin",
  },
});

let recalcResult;
try {
  recalcResult = await processEmail({ message: COMPLETE_EMAIL_RECALC });
} catch (err) {
  fail("recalc scenario CF call failed", err);
}

const recalcData = recalcResult?.data ?? {};
if (recalcData.autoApplied === true && recalcData.readyForPickup === true) {
  pass("server recalc sets ready when physical + staging + no blockers");
} else {
  fail("expected readyForPickup true after recalc", recalcData);
}

const recalcDelivery = await readDoc(["deliveries", "del-email-ready-recalc"]);
if (recalcDelivery?.readinessStatus === "ready_for_pickup") {
  pass("delivery doc readinessStatus ready_for_pickup after recalc");
} else {
  fail("delivery readinessStatus not ready", recalcDelivery);
}

console.log("\n=== CF: duplicate email does not double-apply ===\n");

let dupResult;
try {
  dupResult = await processEmail({ message: COMPLETE_EMAIL });
} catch (err) {
  fail("duplicate email call should return rejected payload", err);
}

const dupData = dupResult?.data ?? {};
if (dupData.duplicate === true && dupData.autoApplied === false) {
  pass("duplicate email rejected without double-apply");
} else {
  fail("duplicate handling wrong", dupData);
}

let dupEventCount = 0;
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const snap = await getDocs(
    query(
      collection(ctx.firestore(), "vendorEmailEvents"),
      where("sourceMessageId", "==", COMPLETE_EMAIL.sourceMessageId),
    ),
  );
  dupEventCount = snap.size;
});
if (dupEventCount >= 2) {
  pass("duplicate attempt logged as separate vendorEmailEvents row");
} else {
  fail(`expected ≥2 events for duplicate message, got ${dupEventCount}`);
}

const deliveryAfterDup = await readDoc(["deliveries", "del-email-write-test"]);
if (deliveryAfterDup?.vendorOrderComplete === true) {
  pass("delivery Condition 1 unchanged after duplicate");
} else {
  fail("duplicate cleared Condition 1", deliveryAfterDup);
}

console.log("\n=== CF: low-confidence → pending_review, no patch ===\n");

await seedDelivery({
  deliveryId: "del-email-low-conf",
  orderNumber: "ORD-1010",
  itemId: "item-low-conf",
});

const lowConfBefore = await readDoc(["deliveries", "del-email-low-conf"]);
let lowConfResult;
try {
  lowConfResult = await processEmail({ message: LOW_CONFIDENCE_EMAIL });
} catch (err) {
  fail("low-confidence call should succeed with pending_review", err);
}

const lowConfData = lowConfResult?.data ?? {};
if (lowConfData.reviewStatus === "pending_review" && lowConfData.autoApplied === false) {
  pass("low-confidence email pending_review");
} else {
  fail("expected pending_review for ambiguous email", lowConfData);
}

const lowConfAfter = await readDoc(["deliveries", "del-email-low-conf"]);
if (
  lowConfAfter?.vendorOrderComplete !== true &&
  lowConfBefore?.vendorOrderComplete !== true
) {
  pass("low-confidence email did not patch Condition 1");
} else {
  fail("low-confidence must not auto-apply Condition 1", lowConfAfter);
}

console.log("\n=== CF: item conflict → pending_review, no patch ===\n");

await seedDelivery({
  deliveryId: "del-email-conflict",
  orderNumber: "ORD-1009",
  itemId: "item-conflict",
  itemOverrides: {
    qtyBackordered: 2,
  },
});

const conflictBefore = await readDoc(["deliveries", "del-email-conflict"]);
let conflictResult;
try {
  conflictResult = await processEmail({ message: CONFLICT_EMAIL });
} catch (err) {
  fail("conflict scenario call should return pending_review", err);
}

const conflictData = conflictResult?.data ?? {};
if (
  conflictData.reviewStatus === "pending_review" &&
  conflictData.autoApplied === false &&
  conflictData.applyConflictReason === "unresolved_backorder_on_items"
) {
  pass("conflicting delivery pending_review with applyConflictReason");
} else {
  fail("expected backorder applyConflictReason", conflictData);
}

const conflictAfter = await readDoc(["deliveries", "del-email-conflict"]);
if (
  conflictAfter?.vendorOrderComplete !== true &&
  conflictBefore?.vendorOrderComplete !== true
) {
  pass("conflict scenario did not patch Condition 1");
} else {
  fail("conflict must not auto-apply Condition 1", conflictAfter);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
await testEnv.cleanup();

if (failed > 0) process.exit(1);
console.log("test:process-inbound-vendor-email PASS");
