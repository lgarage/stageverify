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
import {
  scoreJobMatchFromInvoiceHints,
  shellDeliveryIdForImport,
  jobIdFromInvoicePoSlug,
} from "../functions/lib/invoice/createDeliveryShellFromImport.js";

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

console.log("\n=== Unit: scoreJobMatchFromInvoiceHints (P411190 / blackduck) ===\n");

const p411190Header = {
  customerAccountNumber: "0008745",
  vendorOrderNumber: "4046362",
  vendorInvoiceNumber: "P411190",
  customerPoOrReference: "blackduck hartfo",
  orderDate: "2026-01-07",
  invoiceDate: "2026-01-08",
  shipViaRaw: "Fond du Lac",
  vendorBranchName: "Johnstone Supply",
  soldToName: "SJS HEATING & COOLING, LLC",
  shipToName: "SJS HEATING & COOLING, LLC",
  fulfillmentMethod: "unknown",
  shipCompletePolicy: "unknown",
};

const blackduckScore = scoreJobMatchFromInvoiceHints(p411190Header, {
  jobNumber: "26-1042",
  jobName: "Black Duck Hartford",
});
if (blackduckScore >= 12) {
  pass("blackduck hartfo matches Black Duck Hartford job name");
} else {
  fail("blackduck hartfo job match score", { blackduckScore });
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
  jobNumberRaw: "PF-100",
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
    await setDoc(doc(adminDb, "jobs", "job-blackduck"), {
      id: "job-blackduck",
      jobNumber: "26-1042",
      jobName: "Black Duck Hartford",
      status: "active",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    await setDoc(doc(adminDb, "jobs", "job-1"), {
      id: "job-1",
      jobNumber: "PF-100",
      jobName: "Planet Fitness",
      status: "active",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    await setDoc(doc(adminDb, "vendors", "vendor-1"), {
      id: "vendor-1",
      name: "Johnstone Supply",
      active: true,
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
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
const shellDeliveryId = shellDeliveryIdForImport("vii-review-only-test");
if (
  reviewOnlyData.reviewStatus === "approved" &&
  reviewOnlyData.deliveryOrderId === shellDeliveryId &&
  reviewOnlyData.itemsApplied === 2 &&
  reviewOnlyData.shellCreated === true
) {
  pass("review-only approve returned approved with shell delivery");
} else {
  fail("review-only approve response", reviewOnlyData);
}

const reviewOnlySnap = await getDoc(doc(db, "vendorInvoiceImports", "vii-review-only-test"));
if (
  reviewOnlySnap.data()?.reviewStatus === "approved" &&
  reviewOnlySnap.data()?.linkedDeliveryOrderId === shellDeliveryId
) {
  pass("import marked approved with linked shell delivery");
} else {
  fail("review-only import state", reviewOnlySnap.data());
}

const decisionLog = reviewOnlySnap.data()?.importDecisionLog ?? [];
if (
  decisionLog.length === 1 &&
  decisionLog[0].action === "approve" &&
  typeof decisionLog[0].by === "string" &&
  decisionLog[0].importDecisionMode
) {
  pass("approve decision logged with eligibility snapshot");
} else {
  fail("import decision log after approve", decisionLog);
}

const shellDeliverySnap = await getDoc(doc(db, "deliveries", shellDeliveryId));
const shellDelivery = shellDeliverySnap.data() ?? {};
if (
  shellDelivery.vendorInvoiceImportId === "vii-review-only-test" &&
  shellDelivery.invoiceImportStatus === "pickup_at_vendor" &&
  shellDelivery.status === "complete" &&
  shellDelivery.stagingLocationId === undefined &&
  shellDelivery.readinessStatus === undefined
) {
  pass("shell delivery created with will-call status, no staging/readiness");
} else {
  fail("shell delivery fields", shellDelivery);
}

const shellItemsSnap = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", shellDeliveryId)),
);
const shellItems = shellItemsSnap.docs.map((d) => d.data());
if (shellItems.length === 2 && shellItems.every((i) => i.qtyReceived === 0)) {
  pass("shell items created with qtyReceived=0");
} else {
  fail("shell items after review-only approve", shellItems);
}

console.log("\n=== CF: review-only approve patches orphan shell slot ===\n");

const orphanShellId = shellDeliveryIdForImport("vii-orphan-shell-test");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-orphan-shell-test"), {
    id: "vii-orphan-shell-test",
    inboundEmailProcessingId: "inbound-orphan-shell",
    gmailMessageId: "msg-orphan-shell",
    importBatchId: "batch-test",
    pageId: "inv-orphan-shell",
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
  await setDoc(doc(adminDb, "deliveries", orphanShellId), {
    id: orphanShellId,
    orderNumber: "orphan-placeholder",
    jobId: "job-1",
    vendorId: "vendor-johnstone",
    deliveryDate: "2026-06-23",
    status: "pending",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-orphan-shell-test",
    action: "approve",
  });
  pass("review-only approve succeeded with pre-existing shell-slot delivery");
} catch (err) {
  fail("orphan shell slot approve call failed", err?.message);
}

const orphanShellSnap = await getDoc(doc(db, "deliveries", orphanShellId));
const orphanShell = orphanShellSnap.data() ?? {};
if (orphanShell.vendorInvoiceImportId === "vii-orphan-shell-test") {
  pass("orphan shell slot stamped with vendorInvoiceImportId for prod list visibility");
} else {
  fail("orphan shell slot vendorInvoiceImportId", orphanShell);
}

let duplicateShellResult;
try {
  duplicateShellResult = await approveImport({
    vendorInvoiceImportId: "vii-review-only-test",
    action: "create_shell",
  });
  const dupData = duplicateShellResult?.data ?? {};
  if (dupData.deliveryOrderId === shellDeliveryId && dupData.itemsApplied === 0 && dupData.shellCreated === false) {
    pass("create_shell idempotent when already linked");
  } else {
    fail("create_shell idempotent response", dupData);
  }
} catch (err) {
  fail("create_shell idempotent call failed", err?.message);
}

const shellItemsAfterDup = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", shellDeliveryId)),
);
if (shellItemsAfterDup.docs.length === 2) {
  pass("no duplicate shell items on create_shell retry");
} else {
  fail("duplicate shell items count", shellItemsAfterDup.docs.length);
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-issue-test"), {
    id: "vii-issue-test",
    inboundEmailProcessingId: "inbound-issue",
    gmailMessageId: "msg-issue",
    importBatchId: "batch-test",
    pageId: "inv-issue",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "issue",
    confidenceTier: "low",
    confidenceScore: 30,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: { ...header, vendorInvoiceNumber: "" },
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: ["missing vendorInvoiceNumber"],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-issue-test",
    action: "approve",
  });
  fail("issue import approve should be denied");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (msg.includes("parse issues") || msg.includes("failed-precondition")) {
    pass("issue import approve blocked");
  } else {
    fail("expected issue import block", err?.message);
  }
}

try {
  await approveImport({
    vendorInvoiceImportId: "vii-link-test",
    action: "link",
    deliveryOrderId: "delivery-link-test",
  });
  fail("link action should be rejected");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (msg.includes("Link removed") || msg.includes("invalid-argument")) {
    pass("link action rejected");
  } else {
    fail("expected link removal error", err?.message);
  }
}

try {
  await approveImport({
    vendorInvoiceImportId: "vii-approve-test",
    action: "approve",
    deliveryOrderId: "delivery-approve-test",
  });
  fail("approve with deliveryOrderId should be rejected");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (msg.includes("always creates") || msg.includes("invalid-argument")) {
    pass("approve with deliveryOrderId rejected");
  } else {
    fail("expected approve deliveryOrderId rejection", err?.message);
  }
}

let approveResult;
try {
  approveResult = await approveImport({
    vendorInvoiceImportId: "vii-approve-test",
    action: "approve",
  });
} catch (err) {
  fail("approve call failed", err?.message);
}

const approveShellId = shellDeliveryIdForImport("vii-approve-test");
const approveData = approveResult?.data ?? {};
if (
  approveData.reviewStatus === "approved" &&
  approveData.itemsApplied === 2 &&
  approveData.deliveryOrderId === approveShellId &&
  approveData.shellCreated === true
) {
  pass("approve returned approved with shell delivery");
} else {
  fail("approve response", approveData);
}

const deliverySnap = await getDoc(doc(db, "deliveries", approveShellId));
if (deliverySnap.data()?.vendorInvoiceImportId === "vii-approve-test") {
  pass("shell delivery linked to import");
} else {
  fail("shell delivery link missing", deliverySnap.data());
}

if (
  deliverySnap.data()?.stagingLocationId === undefined &&
  deliverySnap.data()?.readinessStatus === undefined
) {
  pass("shell staging/readiness untouched");
} else {
  fail("unexpected staging/readiness on shell", deliverySnap.data());
}

const itemsSnap = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", approveShellId)),
);
const items = itemsSnap.docs.map((d) => d.data());
if (items.length === 2 && items.every((i) => i.qtyReceived === 0)) {
  pass("items created with qtyReceived=0");
} else {
  fail("items after approve", items);
}

console.log("\n=== CF: relink_to_shell moves off shared delivery ===\n");

const sharedDeliveryId = "delivery-shared-non-shell";
const relinkImportId = "vii-relink-test";
const relinkShellId = shellDeliveryIdForImport(relinkImportId);
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", sharedDeliveryId), {
    id: sharedDeliveryId,
    jobId: "job-1",
    vendorId: "vendor-johnstone",
    orderNumber: "ORD-SHARED",
    status: "pending",
    vendorInvoiceImportId: relinkImportId,
    deliveryDate: "2026-06-24",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", relinkImportId), {
    id: relinkImportId,
    inboundEmailProcessingId: "inbound-relink",
    gmailMessageId: "msg-relink",
    importBatchId: "batch-test",
    pageId: "inv-relink",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 70,
    humanReviewRequired: true,
    duplicate: false,
    linkedDeliveryOrderId: sharedDeliveryId,
    parsedHeader: header,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-06-24T10:00:00Z",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let relinkResult;
try {
  relinkResult = await approveImport({
    vendorInvoiceImportId: relinkImportId,
    action: "relink_to_shell",
  });
} catch (err) {
  fail("relink_to_shell call failed", err?.message);
}

const relinkData = relinkResult?.data ?? {};
if (
  relinkData.deliveryOrderId === relinkShellId &&
  relinkData.shellCreated === true &&
  relinkData.relinked === true
) {
  pass("relink_to_shell created separate shell");
} else {
  fail("relink_to_shell response", relinkData);
}

const relinkImportSnap = await getDoc(doc(db, "vendorInvoiceImports", relinkImportId));
if (relinkImportSnap.data()?.linkedDeliveryOrderId === relinkShellId) {
  pass("import retargeted to shell");
} else {
  fail("import after relink", relinkImportSnap.data());
}

const sharedAfter = await getDoc(doc(db, "deliveries", sharedDeliveryId));
if (!sharedAfter.data()?.vendorInvoiceImportId) {
  pass("old shared delivery stamp cleared");
} else {
  fail("old delivery still stamped", sharedAfter.data());
}

const relinkShellSnap = await getDoc(doc(db, "deliveries", relinkShellId));
if (relinkShellSnap.data()?.vendorInvoiceImportId === relinkImportId) {
  pass("shell stamped with import id");
} else {
  fail("relink shell missing stamp", relinkShellSnap.data());
}

const relinkItems = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", relinkShellId)),
);
if (relinkItems.docs.length === 2) {
  pass("relink items on shell");
} else {
  fail("relink items count", relinkItems.docs.length);
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  const p411190Lines = [
    {
      lineNumber: 1,
      quantityOrdered: 4,
      quantityShipped: 4,
      quantityBackordered: 0,
      vendorProductNumber: "L97-525",
      description: "FILTER",
      filteredNotes: [],
      lineType: "product",
      excludeFromExpectedItems: false,
    },
  ];
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-p411190-backfill"), {
    id: "vii-p411190-backfill",
    inboundEmailProcessingId: "inbound-p411190",
    gmailMessageId: "msg-p411190",
    importBatchId: "batch-test",
    pageId: "inv-p411190-4046362",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 75,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: p411190Header,
    parsedLines: p411190Lines,
    parsedLineCount: 1,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-06-24T10:00:00Z",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let backfillResult;
try {
  backfillResult = await approveImport({
    vendorInvoiceImportId: "vii-p411190-backfill",
    action: "create_shell",
  });
} catch (err) {
  fail("P411190 create_shell backfill call failed", err?.message);
}

const backfillShellId = shellDeliveryIdForImport("vii-p411190-backfill");
const backfillData = backfillResult?.data ?? {};
if (
  backfillData.reviewStatus === "approved" &&
  backfillData.deliveryOrderId === backfillShellId &&
  backfillData.itemsApplied === 1
) {
  pass("P411190 create_shell backfill returned shell delivery");
} else {
  fail("P411190 create_shell backfill response", backfillData);
}

const backfillShellSnap = await getDoc(doc(db, "deliveries", backfillShellId));
const backfillShell = backfillShellSnap.data() ?? {};
if (
  backfillShell.jobId === "job-blackduck" &&
  backfillShell.orderNumber === "4046362" &&
  backfillShell.createdFromInvoiceImport === true
) {
  pass("P411190 shell delivery linked to Black Duck Hartford job");
} else {
  fail("P411190 shell delivery fields", backfillShell);
}

// Historical backfill: approved import linked to real delivery missing vendorInvoiceImportId stamp
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", "delivery-hist-stamp-test"), {
    id: "delivery-hist-stamp-test",
    orderNumber: "6164159",
    jobId: "job-1",
    vendorId: "vendor-johnstone",
    deliveryDate: "2026-06-23",
    status: "pending",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-hist-stamp-test"), {
    id: "vii-hist-stamp-test",
    inboundEmailProcessingId: "inbound-hist-stamp",
    gmailMessageId: "msg-hist-stamp",
    importBatchId: "batch-test",
    pageId: "inv-hist-stamp",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    linkedDeliveryOrderId: "delivery-hist-stamp-test",
    importStatus: "delivered",
    confidenceTier: "medium",
    confidenceScore: 80,
    humanReviewRequired: false,
    duplicate: false,
    parsedHeader: header,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-06-24T10:00:00Z",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-hist-stamp-test",
    action: "create_shell",
  });
  pass("historical linked delivery create_shell backfill succeeded");
} catch (err) {
  fail("historical linked delivery create_shell backfill failed", err?.message);
}

const histStampSnap = await getDoc(doc(db, "deliveries", "delivery-hist-stamp-test"));
if (histStampSnap.data()?.vendorInvoiceImportId === "vii-hist-stamp-test") {
  pass("historical linked delivery stamped with vendorInvoiceImportId");
} else {
  fail("historical linked delivery vendorInvoiceImportId", histStampSnap.data());
}

// Historical backfill: linked orphan shell slot missing stamp (approved, linked, shell exists)
const histOrphanShellId = shellDeliveryIdForImport("vii-hist-orphan-stamp");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", histOrphanShellId), {
    id: histOrphanShellId,
    orderNumber: "orphan-hist",
    jobId: "job-1",
    vendorId: "vendor-johnstone",
    deliveryDate: "2026-06-23",
    status: "pending",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-hist-orphan-stamp"), {
    id: "vii-hist-orphan-stamp",
    inboundEmailProcessingId: "inbound-hist-orphan",
    gmailMessageId: "msg-hist-orphan",
    importBatchId: "batch-test",
    pageId: "inv-hist-orphan",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    linkedDeliveryOrderId: histOrphanShellId,
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
    approvedAt: "2026-06-24T10:00:00Z",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-hist-orphan-stamp",
    action: "create_shell",
  });
  pass("historical orphan shell create_shell backfill succeeded");
} catch (err) {
  fail("historical orphan shell create_shell backfill failed", err?.message);
}

const histOrphanSnap = await getDoc(doc(db, "deliveries", histOrphanShellId));
if (histOrphanSnap.data()?.vendorInvoiceImportId === "vii-hist-orphan-stamp") {
  pass("historical orphan shell stamped with vendorInvoiceImportId");
} else {
  fail("historical orphan shell vendorInvoiceImportId", histOrphanSnap.data());
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  const autoJobHeader = {
    ...p411190Header,
    vendorInvoiceNumber: "P999001",
    vendorOrderNumber: "999001",
    customerPoOrReference: "zephyr warehouse demo",
  };
  const autoJobLines = [
    {
      lineNumber: 1,
      quantityOrdered: 1,
      quantityShipped: 1,
      quantityBackordered: 0,
      vendorProductNumber: "L97-525",
      description: "FILTER",
      filteredNotes: [],
      lineType: "product",
      excludeFromExpectedItems: false,
    },
  ];
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-auto-job-test"), {
    id: "vii-auto-job-test",
    inboundEmailProcessingId: "inbound-auto-job",
    gmailMessageId: "msg-auto-job",
    importBatchId: "batch-test",
    pageId: "inv-auto-job",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 75,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: autoJobHeader,
    parsedLines: autoJobLines,
    parsedLineCount: 1,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let autoJobApproveResult;
try {
  autoJobApproveResult = await approveImport({
    vendorInvoiceImportId: "vii-auto-job-test",
    action: "approve",
  });
} catch (err) {
  fail("auto-job review-only approve call failed", err?.message);
}

const autoJobData = autoJobApproveResult?.data ?? {};
const autoJobShellId = shellDeliveryIdForImport("vii-auto-job-test");
const autoJobHeader = {
  ...p411190Header,
  vendorInvoiceNumber: "P999001",
  vendorOrderNumber: "999001",
  customerPoOrReference: "zephyr warehouse demo",
};
const expectedAutoJobId = jobIdFromInvoicePoSlug(autoJobHeader);
if (
  autoJobData.reviewStatus === "approved" &&
  autoJobData.deliveryOrderId === autoJobShellId &&
  autoJobData.shellCreated === true &&
  autoJobData.jobCreated === true
) {
  pass("review-only approve auto-created job when no match exists");
} else {
  fail("auto-job approve response", autoJobData);
}

const autoJobSnap = await getDoc(doc(db, "jobs", expectedAutoJobId));
const autoJob = autoJobSnap.data() ?? {};
if (
  autoJob.createdFromInvoiceImport === true &&
  typeof autoJob.jobName === "string" &&
  autoJob.jobName.length > 0
) {
  pass("auto-created job from invoice P/O hints");
} else {
  fail("auto-created job fields", autoJob);
}

console.log("\n=== CF: First Supply SO-less approve ===\n");

const firstSupplyHeader = {
  customerAccountNumber: "91132956",
  vendorOrderNumber: "",
  vendorInvoiceNumber: "15046467-00",
  customerPoOrReference: "2026-0200",
  orderDate: "2026-06-23",
  invoiceDate: "2026-06-23",
  shipDate: "2026-06-23",
  vendorBranchName: "First Supply LLC - Oshkosh",
  soldToName: "TWIN PILLAR",
  shipToName: "TWIN PILLAR",
  shipToAddress: "Oshkosh WI",
  fulfillmentMethod: "unknown",
  shipCompletePolicy: "unknown",
};

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendors", "vendor-first-supply"), {
    id: "vendor-first-supply",
    name: "First Supply LLC",
    active: true,
    createdAt: "2026-06-02T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-first-supply-test"), {
    id: "vii-first-supply-test",
    inboundEmailProcessingId: "inbound-first-supply",
    gmailMessageId: "msg-first-supply",
    importBatchId: "batch-test",
    pageId: "inv-first-supply",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 70,
    humanReviewRequired: true,
    duplicate: false,
    parserFormatId: "first_supply",
    parsedHeader: firstSupplyHeader,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let firstSupplyApproveResult;
try {
  firstSupplyApproveResult = await approveImport({
    vendorInvoiceImportId: "vii-first-supply-test",
    action: "approve",
  });
} catch (err) {
  fail("First Supply SO-less approve call failed", err?.message);
}

const firstSupplyData = firstSupplyApproveResult?.data ?? {};
const firstSupplyShellId = shellDeliveryIdForImport("vii-first-supply-test");
if (
  firstSupplyData.reviewStatus === "approved" &&
  firstSupplyData.deliveryOrderId === firstSupplyShellId &&
  firstSupplyData.shellCreated === true
) {
  pass("First Supply SO-less approve created shell delivery");
} else {
  fail("First Supply SO-less approve response", firstSupplyData);
}

console.log("\n=== CF: both-identity-empty rejection ===\n");

const emptyIdentityHeader = {
  customerAccountNumber: "91132956",
  vendorOrderNumber: "",
  vendorInvoiceNumber: "",
  customerPoOrReference: "2026-0200",
  orderDate: "2026-06-23",
  vendorBranchName: "First Supply LLC - Oshkosh",
  fulfillmentMethod: "unknown",
  shipCompletePolicy: "unknown",
};

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-empty-identity-test"), {
    id: "vii-empty-identity-test",
    inboundEmailProcessingId: "inbound-empty-identity",
    gmailMessageId: "msg-empty-identity",
    importBatchId: "batch-test",
    pageId: "inv-empty-identity",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 70,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: emptyIdentityHeader,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-empty-identity-test",
    action: "approve",
  });
  fail("both-identity-empty approve should be rejected");
} catch (err) {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "");
  if (
    code.includes("failed-precondition") &&
    message.toLowerCase().includes("identity")
  ) {
    pass("both-identity-empty approve rejected with identity error");
  } else {
    fail("expected identity failed-precondition", { code, message });
  }
}

await testEnv.cleanup();

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("test-approve-vendor-invoice-import: PASS");
