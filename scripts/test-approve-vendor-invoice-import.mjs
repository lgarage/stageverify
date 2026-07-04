/**
 * approveVendorInvoiceImport — emulator smoke + offline item builder.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
import { buildExpectedItemsFromImport } from "../functions/lib/invoice/buildExpectedItemsFromImport.js";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const EMULATOR_ONLY = process.env.APPROVE_INVOICE_EMULATOR_ONLY === "1";

if (!process.env.FIRESTORE_EMULATOR_HOST && !EMULATOR_ONLY) {
  console.log("Spawning Firebase emulators for approveVendorInvoiceImport tests…\n");
  const inner = `node scripts/test-approve-vendor-invoice-import.mjs`;
  const child = spawnSync(
    `firebase emulators:exec --only auth,firestore,functions "${inner}"`,
    {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, APPROVE_INVOICE_EMULATOR_ONLY: "1" },
    },
  );
  process.exit(child.status ?? 1);
}

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

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

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, detail) {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

const sampleLines = [
  {
    lineNumber: 1,
    quantityOrdered: 1,
    quantityShipped: 1,
    quantityBackordered: 0,
    vendorProductNumber: "L46-668",
    description: "THERMOSTAT PROGRAMMABLE",
    filteredNotes: [],
    lineType: "product",
    excludeFromExpectedItems: false,
  },
  {
    lineNumber: 2,
    quantityOrdered: 2,
    quantityShipped: 2,
    quantityBackordered: 0,
    vendorProductNumber: "B86-380",
    description: "SEALANT",
    filteredNotes: [],
    lineType: "product",
    excludeFromExpectedItems: false,
  },
];

console.log("\n=== Unit: buildExpectedItemsFromImport ===\n");

const built = buildExpectedItemsFromImport(
  "vii-test",
  "delivery-test",
  "job-1",
  sampleLines,
);
if (built.length === 2 && built.every((i) => i.qtyReceived === 0)) {
  pass("expected items built with qtyReceived=0");
} else {
  fail("item builder shape", built);
}

console.log("\n=== CF: approveVendorInvoiceImport (emulators) ===\n");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync(RULES_PATH, "utf8") },
});

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const approveImport = httpsCallable(functions, "approveVendorInvoiceImport");

const header = {
  customerAccountNumber: "0018114",
  vendorOrderNumber: "6164159",
  vendorInvoiceNumber: "6164159",
  customerPoOrReference: "PLANET FITNESS PICKUP",
  orderDate: "2026-06-23",
  invoiceDate: "2026-06-23",
  shipDate: "2026-06-23",
  vendorBranchName: "Johnstone Supply",
  vendorBranchAddress: "335 N Weber Ave",
  vendorBranchPhone: "605-338-2652",
  soldToName: "TWIN PILLAR",
  shipToName: "TWIN PILLAR",
  shipToAddress: "Green Bay WI",
  fulfillmentMethod: "will_call_pickup",
  shipCompletePolicy: "unknown",
};

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, "deliveries", "delivery-approve-test"), {
      id: "delivery-approve-test",
      orderNumber: "ORD-005",
      jobId: "job-1",
      vendorId: "vendor-1",
      status: "pending",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-approve-test"), {
      id: "vii-approve-test",
      inboundEmailProcessingId: "inbound-test",
      gmailMessageId: "msg-test",
      importBatchId: "batch-test",
      pageId: "inv-test",
      pageIndexInBatch: 0,
      reviewStatus: "pending_review",
      importStatus: "pickup_at_vendor",
      confidenceTier: "medium",
      confidenceScore: 70,
      humanReviewRequired: true,
      duplicate: false,
      parsedHeader: header,
      parsedLines: sampleLines,
      parsedLineCount: 2,
      parseWarnings: [],
      orderNotes: [],
      outcome: "needs_review",
      createdAt: "2026-06-24T10:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
  });
}

await seed();

try {
  await approveImport({
    vendorInvoiceImportId: "vii-approve-test",
    action: "approve",
    deliveryOrderId: "delivery-approve-test",
  });
  fail("unauthenticated approve should be denied");
} catch (err) {
  const code = String(err?.code ?? err?.message ?? "");
  if (code.includes("unauthenticated") || code.includes("permission")) {
    pass("unauthenticated call denied");
  } else {
    fail("expected unauthenticated denial", err?.message);
  }
}

let dispatcherUid;
try {
  const signedIn = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
  dispatcherUid = signedIn.user.uid;
} catch {
  const created = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
  dispatcherUid = created.user.uid;
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "dispatcherRoles", dispatcherUid), {
    active: true,
    email: TEST_EMAIL,
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-review-only-test"), {
    id: "vii-review-only-test",
    inboundEmailProcessingId: "inbound-test-2",
    gmailMessageId: "msg-test-2",
    importBatchId: "batch-test",
    pageId: "inv-test-2",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 70,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: header,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let reviewOnlyResult;
try {
  reviewOnlyResult = await approveImport({
    vendorInvoiceImportId: "vii-review-only-test",
    action: "approve",
  });
} catch (err) {
  fail("review-only approve call failed", err?.message);
}

const reviewOnlyData = reviewOnlyResult?.data ?? {};
if (reviewOnlyData.reviewStatus === "approved" && !reviewOnlyData.deliveryOrderId) {
  pass("review-only approve returned approved without delivery");
} else {
  fail("review-only approve response", reviewOnlyData);
}

const reviewOnlySnap = await getDoc(doc(db, "vendorInvoiceImports", "vii-review-only-test"));
if (
  reviewOnlySnap.data()?.reviewStatus === "approved" &&
  !reviewOnlySnap.data()?.linkedDeliveryOrderId
) {
  pass("import marked approved with no linked delivery");
} else {
  fail("review-only import state", reviewOnlySnap.data());
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", "delivery-link-test"), {
    id: "delivery-link-test",
    jobId: "job-1",
    vendorId: "vendor-test",
    orderNumber: "ORD-LINK",
    status: "pending",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let linkResult;
try {
  linkResult = await approveImport({
    vendorInvoiceImportId: "vii-review-only-test",
    action: "link",
    deliveryOrderId: "delivery-link-test",
  });
} catch (err) {
  fail("link call failed", err?.message);
}

const linkData = linkResult?.data ?? {};
if (linkData.reviewStatus === "approved" && linkData.deliveryOrderId === "delivery-link-test") {
  pass("link returned approved with delivery");
} else {
  fail("link response", linkData);
}

const linkedImportSnap = await getDoc(doc(db, "vendorInvoiceImports", "vii-review-only-test"));
if (linkedImportSnap.data()?.linkedDeliveryOrderId === "delivery-link-test") {
  pass("import linked to delivery");
} else {
  fail("import link state", linkedImportSnap.data());
}

let approveResult;
try {
  approveResult = await approveImport({
    vendorInvoiceImportId: "vii-approve-test",
    action: "approve",
    deliveryOrderId: "delivery-approve-test",
  });
} catch (err) {
  fail("approve call failed", err?.message);
}

const approveData = approveResult?.data ?? {};
if (approveData.reviewStatus === "approved" && approveData.itemsApplied === 2) {
  pass("approve returned approved with 2 items");
} else {
  fail("approve response", approveData);
}

const deliverySnap = await getDoc(doc(db, "deliveries", "delivery-approve-test"));
if (deliverySnap.data()?.vendorInvoiceImportId === "vii-approve-test") {
  pass("delivery linked to import");
} else {
  fail("delivery link missing", deliverySnap.data());
}

if (
  deliverySnap.data()?.stagingLocationId === undefined &&
  deliverySnap.data()?.readinessStatus === undefined
) {
  pass("delivery staging/readiness untouched");
} else {
  fail("unexpected staging/readiness on delivery", deliverySnap.data());
}

const itemsSnap = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", "delivery-approve-test")),
);
const items = itemsSnap.docs.map((d) => d.data());
if (items.length === 2 && items.every((i) => i.qtyReceived === 0)) {
  pass("items created with qtyReceived=0");
} else {
  fail("items after approve", items);
}

await testEnv.cleanup();

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("test-approve-vendor-invoice-import: PASS");
