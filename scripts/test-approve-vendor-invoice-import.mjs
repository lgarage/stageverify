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
const shellPlanned = shellDelivery.plannedStagingLocationIds;
const shellActualEmpty =
  shellDelivery.stagingLocationId === undefined ||
  shellDelivery.stagingLocationId === "";
const shellPlannedEmpty =
  shellPlanned === undefined ||
  (Array.isArray(shellPlanned) && shellPlanned.length === 0);
if (
  shellDelivery.vendorInvoiceImportId === "vii-review-only-test" &&
  shellDelivery.invoiceImportStatus === "pickup_at_vendor" &&
  shellDelivery.status === "ready_for_pickup" &&
  shellActualEmpty &&
  shellPlannedEmpty &&
  shellDelivery.readinessStatus === undefined
) {
  pass("shell delivery created with will-call status, no active staging/readiness");
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
  fail("approve with unrelated deliveryOrderId should be rejected");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (
    msg.includes("does not match the server-resolved") ||
    msg.includes("invalid-argument")
  ) {
    pass("approve with unrelated deliveryOrderId rejected");
  } else {
    fail("expected approve deliveryOrderId mismatch rejection", err?.message);
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

const approveShellPlanned = deliverySnap.data()?.plannedStagingLocationIds;
if (
  (deliverySnap.data()?.stagingLocationId === undefined ||
    deliverySnap.data()?.stagingLocationId === "") &&
  deliverySnap.data()?.readinessStatus === undefined &&
  (approveShellPlanned === undefined ||
    (Array.isArray(approveShellPlanned) && approveShellPlanned.length === 0))
) {
  pass("shell staging/readiness empty for will-call (no active shop staging)");
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

// --- Operational fulfillment preserve through create_shell backfill (6169414/6169474-equivalent) ---
console.log("\n=== CF: create_shell preserves dispatcher operational fulfillment ===\n");

const preserveDropOffImportId = "vii-fulfillment-preserve-repro";
const preserveDropOffDeliveryId = shellDeliveryIdForImport(preserveDropOffImportId);
const preserveDropOffHeader = {
  ...header,
  vendorInvoiceNumber: "INV-FULFILL-PRESERVE-A",
  vendorOrderNumber: "ORD-FULFILL-PRESERVE-A",
  customerPoOrReference: "2205 EARLY FIXTURE A",
  fulfillmentMethod: "will_call_pickup",
};
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", preserveDropOffDeliveryId), {
    id: preserveDropOffDeliveryId,
    orderNumber: "INV-FULFILL-PRESERVE-A",
    jobId: "job-inv-fulfill-preserve-a",
    vendorId: "vendor-johnstone",
    vendorName: "Johnstone",
    deliveryDate: "2026-08-09",
    status: "pending",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: preserveDropOffImportId,
    invoiceFulfillmentMethod: "delivery",
    invoiceImportStatus: "pending",
    plannedStagingLocationIds: ["zone-fixture-g12"],
    stagingLocationId: null,
    vendorInvoiceNumber: "INV-FULFILL-PRESERVE-A",
    vendorOrderNumber: "ORD-FULFILL-PRESERVE-A",
    customerPoOrReference: "2205 EARLY FIXTURE A",
    createdAt: "2026-08-09T17:00:00Z",
    updatedAt: "2026-08-09T18:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", preserveDropOffImportId), {
    id: preserveDropOffImportId,
    inboundEmailProcessingId: "inbound-fulfill-preserve-a",
    gmailMessageId: "msg-fulfill-preserve-a",
    importBatchId: "batch-test",
    pageId: "inv-fulfill-preserve-a",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    linkedDeliveryOrderId: preserveDropOffDeliveryId,
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 80,
    humanReviewRequired: false,
    duplicate: false,
    parsedHeader: preserveDropOffHeader,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-08-09T17:00:00Z",
    createdAt: "2026-08-09T17:00:00Z",
    updatedAt: "2026-08-09T17:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: preserveDropOffImportId,
    action: "create_shell",
  });
  pass("create_shell backfill succeeded for Drop-Off ops preserve fixture");
} catch (err) {
  fail("create_shell Drop-Off ops preserve call failed", err?.message);
}

const preserveDropOffSnap = await getDoc(
  doc(db, "deliveries", preserveDropOffDeliveryId),
);
const preserveDropOffData = preserveDropOffSnap.data() ?? {};
if (
  preserveDropOffData.invoiceFulfillmentMethod === "delivery" &&
  preserveDropOffData.invoiceImportStatus === "pending" &&
  preserveDropOffData.status === "pending" &&
  Array.isArray(preserveDropOffData.plannedStagingLocationIds) &&
  preserveDropOffData.plannedStagingLocationIds[0] === "zone-fixture-g12"
) {
  pass(
    "Will-Call import create_shell does not revert dispatcher Vendor Drop-Off (+ keeps planned staging)",
  );
} else {
  fail("Drop-Off ops overwritten by create_shell", {
    invoiceFulfillmentMethod: preserveDropOffData.invoiceFulfillmentMethod,
    invoiceImportStatus: preserveDropOffData.invoiceImportStatus,
    status: preserveDropOffData.status,
    plannedStagingLocationIds: preserveDropOffData.plannedStagingLocationIds,
  });
}

const preserveWillCallImportId = "vii-fulfillment-preserve-repro-rev";
const preserveWillCallDeliveryId = shellDeliveryIdForImport(
  preserveWillCallImportId,
);
const preserveWillCallHeader = {
  ...header,
  vendorInvoiceNumber: "INV-FULFILL-PRESERVE-B",
  vendorOrderNumber: "ORD-FULFILL-PRESERVE-B",
  customerPoOrReference: "2205 EARLY FIXTURE B",
  fulfillmentMethod: "delivery",
};
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", preserveWillCallDeliveryId), {
    id: preserveWillCallDeliveryId,
    orderNumber: "INV-FULFILL-PRESERVE-B",
    jobId: "job-inv-fulfill-preserve-b",
    vendorId: "vendor-johnstone",
    vendorName: "Johnstone",
    deliveryDate: "2026-08-09",
    status: "ready_for_pickup",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: preserveWillCallImportId,
    invoiceFulfillmentMethod: "will_call_pickup",
    invoiceImportStatus: "pickup_at_vendor",
    plannedStagingLocationIds: ["zone-fixture-g6"],
    vendorInvoiceNumber: "INV-FULFILL-PRESERVE-B",
    vendorOrderNumber: "ORD-FULFILL-PRESERVE-B",
    customerPoOrReference: "2205 EARLY FIXTURE B",
    createdAt: "2026-08-09T17:00:00Z",
    updatedAt: "2026-08-09T18:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", preserveWillCallImportId), {
    id: preserveWillCallImportId,
    inboundEmailProcessingId: "inbound-fulfill-preserve-b",
    gmailMessageId: "msg-fulfill-preserve-b",
    importBatchId: "batch-test",
    pageId: "inv-fulfill-preserve-b",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    linkedDeliveryOrderId: preserveWillCallDeliveryId,
    importStatus: "pending",
    confidenceTier: "medium",
    confidenceScore: 80,
    humanReviewRequired: false,
    duplicate: false,
    parsedHeader: preserveWillCallHeader,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-08-09T17:00:00Z",
    createdAt: "2026-08-09T17:00:00Z",
    updatedAt: "2026-08-09T17:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: preserveWillCallImportId,
    action: "create_shell",
  });
  pass("create_shell backfill succeeded for Will-Call ops preserve fixture");
} catch (err) {
  fail("create_shell Will-Call ops preserve call failed", err?.message);
}

const preserveWillCallSnap = await getDoc(
  doc(db, "deliveries", preserveWillCallDeliveryId),
);
const preserveWillCallData = preserveWillCallSnap.data() ?? {};
const preserveWillCallPlanned =
  preserveWillCallData.plannedStagingLocationIds ?? [];
if (
  preserveWillCallData.invoiceFulfillmentMethod === "will_call_pickup" &&
  preserveWillCallData.invoiceImportStatus === "pickup_at_vendor" &&
  Array.isArray(preserveWillCallPlanned) &&
  preserveWillCallPlanned.length === 0
) {
  pass(
    "Drop-Off import create_shell preserves Will-Call ops and clears active staging (D-80)",
  );
} else {
  fail("Will-Call ops/staging after create_shell", {
    invoiceFulfillmentMethod: preserveWillCallData.invoiceFulfillmentMethod,
    invoiceImportStatus: preserveWillCallData.invoiceImportStatus,
    status: preserveWillCallData.status,
    plannedStagingLocationIds: preserveWillCallData.plannedStagingLocationIds,
  });
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

console.log("\n=== CF: credit/return approve blocked ===\n");

const creditReturnLines = [
  {
    lineNumber: 1,
    quantityOrdered: -1,
    quantityShipped: -1,
    quantityBackordered: 0,
    vendorProductNumber: "B50-968",
    description: "return from invoice 6167746",
    filteredNotes: [],
    lineType: "return",
    excludeFromExpectedItems: false,
  },
];

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-credit-block-test"), {
    id: "vii-credit-block-test",
    inboundEmailProcessingId: "inbound-credit-block",
    gmailMessageId: "msg-credit-block",
    importBatchId: "batch-test",
    pageId: "inv-credit-block",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceTier: "medium",
    confidenceScore: 90,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: {
      ...header,
      vendorInvoiceNumber: "3316448A",
      vendorBranchName: "Johnstone Supply",
    },
    parsedLines: creditReturnLines,
    parsedLineCount: 1,
    parseWarnings: [],
    orderNotes: ["CREDIT/return memo"],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-credit-block-test",
    action: "approve",
  });
  fail("credit/return approve should be rejected");
} catch (err) {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "");
  if (
    code.includes("failed-precondition") &&
    /credit\/return/i.test(message)
  ) {
    pass("credit/return approve blocked — no delivery shell created");
  } else {
    fail("expected credit failed-precondition", { code, message });
  }
}

const creditDeliverySnap = await getDoc(
  doc(db, "deliveries", shellDeliveryIdForImport("vii-credit-block-test")),
);
if (!creditDeliverySnap.exists()) {
  pass("credit approve did not create delivery shell");
} else {
  fail("credit approve created delivery shell", creditDeliverySnap.id);
}

console.log("\n=== CF: sticky manual reject — reopen blocked; system skip reopen OK ===\n");

const stickyHeader = {
  ...header,
  vendorInvoiceNumber: "STICKY-MANUAL-001",
};

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-manual-reject-sticky"), {
    id: "vii-manual-reject-sticky",
    inboundEmailProcessingId: "inbound-manual-sticky",
    gmailMessageId: "msg-manual-sticky",
    importBatchId: "batch-test",
    pageId: "inv-manual-sticky",
    pageIndexInBatch: 0,
    reviewStatus: "rejected",
    importStatus: "pending",
    confidenceTier: "medium",
    confidenceScore: 70,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: stickyHeader,
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "skipped",
    skipReason: "credit_return",
    rejectedAt: "2026-08-08T12:00:00Z",
    rejectedBy: dispatcherUid,
    importDecisionLog: [
      {
        action: "reject",
        at: "2026-08-08T12:00:00Z",
        by: dispatcherUid,
        importDecisionMode: "blocked",
        autoImportEligible: false,
        autoImportReasons: [],
        reviewRequiredReasons: ["Credit/return memo — not valid for delivery import"],
      },
    ],
    createdAt: "2026-08-08T11:00:00Z",
    updatedAt: "2026-08-08T12:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-system-skip-reopen-ok"), {
    id: "vii-system-skip-reopen-ok",
    inboundEmailProcessingId: "inbound-system-skip-reopen",
    gmailMessageId: "msg-system-skip-reopen",
    importBatchId: "batch-test",
    pageId: "inv-system-skip-reopen",
    pageIndexInBatch: 0,
    reviewStatus: "rejected",
    importStatus: "pending",
    confidenceTier: "medium",
    confidenceScore: 70,
    humanReviewRequired: false,
    duplicate: false,
    parsedHeader: { ...header, vendorInvoiceNumber: "SYS-SKIP-REOPEN-001" },
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "skipped",
    skipReason: "credit_return",
    rejectedAt: "2026-08-08T12:00:00Z",
    rejectedBy: "system:credit_return_skip",
    createdAt: "2026-08-08T11:00:00Z",
    updatedAt: "2026-08-08T12:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-manual-reject-sticky",
    action: "reopen",
  });
  fail("manual reject reopen should be blocked");
} catch (err) {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "");
  if (
    code.includes("failed-precondition") &&
    /manually rejected/i.test(message)
  ) {
    pass("manual reject reopen blocked with failed-precondition");
  } else {
    fail("expected manual_reject failed-precondition", { code, message });
  }
}

const stickyAfter = await getDoc(doc(db, "vendorInvoiceImports", "vii-manual-reject-sticky"));
const stickyData = stickyAfter.data();
if (
  stickyData?.reviewStatus === "rejected" &&
  stickyData?.rejectedBy === dispatcherUid &&
  Array.isArray(stickyData?.importDecisionLog) &&
  stickyData.importDecisionLog.length === 1 &&
  stickyData.importDecisionLog[0]?.action === "reject"
) {
  pass("manual reject doc unchanged after blocked reopen (log preserved)");
} else {
  fail("manual reject doc mutated or log rewritten", stickyData);
}

try {
  const reopenSys = await approveImport({
    vendorInvoiceImportId: "vii-system-skip-reopen-ok",
    action: "reopen",
  });
  const reopenStatus = reopenSys?.data?.reviewStatus;
  if (reopenStatus === "pending_review") {
    pass("system credit_return_skip reopen still succeeds");
  } else {
    fail("system skip reopen did not return pending_review", reopenSys?.data);
  }
} catch (err) {
  fail("system skip reopen should succeed", {
    code: String(err?.code ?? ""),
    message: String(err?.message ?? ""),
  });
}

console.log("\n=== CF: approve plannedStagingLocationIds (drop-off / will-call) ===\n");

const dropOffHeader = {
  ...header,
  fulfillmentMethod: "delivery",
  customerPoOrReference: "DROP OFF STAGING",
  vendorInvoiceNumber: "DROP-STG-1",
  vendorOrderNumber: "DROP-STG-1",
};

const willCallHeader = {
  ...header,
  fulfillmentMethod: "will_call_pickup",
  customerPoOrReference: "WILL CALL STAGING",
  vendorInvoiceNumber: "WILL-STG-1",
  vendorOrderNumber: "WILL-STG-1",
};

/** Seed staging locations scoped to a scenario prefix to avoid cross-scenario occupancy. */
async function seedScenarioStagingLocations(adminDb, prefix, codes) {
  for (const code of codes) {
    const id = `staging-${prefix}-${code}`;
    await setDoc(doc(adminDb, "stagingLocations", id), {
      id,
      code: code.toUpperCase(),
      label: `Ground ${code.toUpperCase()}`,
      type: "Ground",
      status: "Active",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
  }
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await seedScenarioStagingLocations(adminDb, "dropoff-one", ["g1"]);
  await seedScenarioStagingLocations(adminDb, "dropoff-multi", ["g1", "g2"]);
  await seedScenarioStagingLocations(adminDb, "dropoff-bad", ["g1"]);
  await seedScenarioStagingLocations(adminDb, "dropoff-reapprove", ["g1", "g2"]);
  await seedScenarioStagingLocations(adminDb, "willcall-stale", ["g1", "g2"]);
  await seedScenarioStagingLocations(adminDb, "dropoff-occupied", ["occ"]);
  await seedScenarioStagingLocations(adminDb, "fulfill-dropoff", ["fd1"]);
  await seedScenarioStagingLocations(adminDb, "fulfill-willcall", ["fw1"]);
  await seedScenarioStagingLocations(adminDb, "idempotent-retry", ["ir1"]);
  await seedScenarioStagingLocations(adminDb, "idempotent-contradict", ["ic1"]);
  await seedScenarioStagingLocations(adminDb, "override-d79", ["od1"]);
  for (const id of [
    "vii-dropoff-no-staging",
    "vii-dropoff-one",
    "vii-dropoff-multi",
    "vii-dropoff-bad-loc",
    "vii-dropoff-reapprove",
    "vii-dropoff-occupied",
    "vii-fulfill-dropoff",
    "vii-fulfill-willcall",
    "vii-idempotent-retry",
    "vii-idempotent-contradict",
    "vii-override-d79",
  ]) {
    await setDoc(doc(adminDb, "vendorInvoiceImports", id), {
      id,
      inboundEmailProcessingId: `inbound-${id}`,
      gmailMessageId: `msg-${id}`,
      importBatchId: "batch-staging",
      pageId: `inv-${id}`,
      pageIndexInBatch: 0,
      reviewStatus: "pending_review",
      importStatus: "pending",
      confidenceTier: "medium",
      confidenceScore: 70,
      humanReviewRequired: true,
      duplicate: false,
      parsedHeader: {
        ...dropOffHeader,
        vendorInvoiceNumber: id,
        vendorOrderNumber: id,
      },
      parsedLines: sampleLines,
      parsedLineCount: 2,
      parseWarnings: [],
      orderNotes: [],
      outcome: "needs_review",
      createdAt: "2026-06-24T10:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
  }
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-willcall-stale-staging"), {
    id: "vii-willcall-stale-staging",
    inboundEmailProcessingId: "inbound-willcall-stale",
    gmailMessageId: "msg-willcall-stale",
    importBatchId: "batch-staging",
    pageId: "inv-willcall-stale",
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
  // Occupied location held by another active delivery
  await setDoc(doc(adminDb, "deliveries", "delivery-occupies-dropoff-occ"), {
    id: "delivery-occupies-dropoff-occ",
    jobId: "job-1",
    vendorId: "vendor-1",
    orderNumber: "OCCUPIER-1",
    status: "pending",
    plannedStagingLocationIds: ["staging-dropoff-occupied-occ"],
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
});

try {
  await approveImport({
    vendorInvoiceImportId: "vii-dropoff-no-staging",
    action: "approve",
  });
  fail("drop-off approve without staging should fail");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (
    msg.includes("Choose a staging location") ||
    msg.includes("failed-precondition")
  ) {
    pass("drop-off approve blocked without staging");
  } else {
    fail("expected drop-off staging required error", err?.message);
  }
}

try {
  await approveImport({
    vendorInvoiceImportId: "vii-dropoff-bad-loc",
    action: "approve",
    plannedStagingLocationIds: ["staging-does-not-exist"],
  });
  fail("drop-off approve with missing location should fail");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (
    msg.includes("not found") ||
    msg.includes("no longer exist") ||
    msg.includes("invalid-argument")
  ) {
    pass("drop-off approve rejects missing staging location id");
  } else {
    fail("expected missing staging location error", err?.message);
  }
}

try {
  await approveImport({
    vendorInvoiceImportId: "vii-dropoff-occupied",
    action: "approve",
    plannedStagingLocationIds: ["staging-dropoff-occupied-occ"],
  });
  fail("drop-off approve into occupied location should fail");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (
    msg.includes("no longer available") ||
    msg.includes("failed-precondition")
  ) {
    pass("drop-off approve blocked when staging location occupied");
  } else {
    fail("expected occupied staging error", err?.message);
  }
}
const occupiedImportSnap = await getDoc(
  doc(db, "vendorInvoiceImports", "vii-dropoff-occupied"),
);
if (occupiedImportSnap.data()?.reviewStatus === "pending_review") {
  pass("occupied conflict leaves import pending_review");
} else {
  fail("occupied conflict should not approve import", occupiedImportSnap.data());
}

let dropOne;
try {
  dropOne = await approveImport({
    vendorInvoiceImportId: "vii-dropoff-one",
    action: "approve",
    plannedStagingLocationIds: ["staging-dropoff-one-g1"],
  });
} catch (err) {
  fail("drop-off approve with one location failed", err?.message);
}
const dropOneShell = shellDeliveryIdForImport("vii-dropoff-one");
const dropOneSnap = await getDoc(doc(db, "deliveries", dropOneShell));
const dropOnePlanned = dropOneSnap.data()?.plannedStagingLocationIds;
if (
  dropOne?.data?.reviewStatus === "approved" &&
  Array.isArray(dropOnePlanned) &&
  dropOnePlanned.length === 1 &&
  dropOnePlanned[0] === "staging-dropoff-one-g1" &&
  Array.isArray(dropOne?.data?.plannedStagingLocationIds) &&
  dropOne.data.plannedStagingLocationIds[0] === "staging-dropoff-one-g1"
) {
  pass("drop-off approve writes plannedStagingLocationIds (one)");
} else {
  fail("drop-off one-location response/doc", {
    response: dropOne?.data,
    planned: dropOnePlanned,
  });
}

let dropMulti;
try {
  dropMulti = await approveImport({
    vendorInvoiceImportId: "vii-dropoff-multi",
    action: "approve",
    plannedStagingLocationIds: [
      "staging-dropoff-multi-g1",
      "staging-dropoff-multi-g2",
      "staging-dropoff-multi-g1",
    ],
  });
} catch (err) {
  fail("drop-off approve with multiple locations failed", err?.message);
}
const dropMultiShell = shellDeliveryIdForImport("vii-dropoff-multi");
const dropMultiSnap = await getDoc(doc(db, "deliveries", dropMultiShell));
const dropMultiPlanned = dropMultiSnap.data()?.plannedStagingLocationIds ?? [];
if (
  dropMulti?.data?.reviewStatus === "approved" &&
  dropMultiPlanned.length === 2 &&
  dropMultiPlanned.includes("staging-dropoff-multi-g1") &&
  dropMultiPlanned.includes("staging-dropoff-multi-g2")
) {
  pass("drop-off approve writes deduped multi plannedStagingLocationIds");
} else {
  fail("drop-off multi-location planned ids", dropMultiPlanned);
}

let willStale;
try {
  willStale = await approveImport({
    vendorInvoiceImportId: "vii-willcall-stale-staging",
    action: "approve",
    plannedStagingLocationIds: [
      "staging-willcall-stale-g1",
      "staging-willcall-stale-g2",
    ],
  });
} catch (err) {
  fail("will-call approve with stale staging ids failed", err?.message);
}
const willStaleShell = shellDeliveryIdForImport("vii-willcall-stale-staging");
const willStaleSnap = await getDoc(doc(db, "deliveries", willStaleShell));
const willStaleDocPlanned = willStaleSnap.data()?.plannedStagingLocationIds;
if (
  willStale?.data?.reviewStatus === "approved" &&
  Array.isArray(willStale?.data?.plannedStagingLocationIds) &&
  willStale.data.plannedStagingLocationIds.length === 0 &&
  Array.isArray(willStaleDocPlanned) &&
  willStaleDocPlanned.length === 0 &&
  (willStaleSnap.data()?.stagingLocationId === "" ||
    willStaleSnap.data()?.stagingLocationId === undefined)
) {
  pass("will-call clears active staging (stale client ids not applied)");
} else {
  fail("will-call stale staging should clear active refs", {
    response: willStale?.data,
    doc: willStaleSnap.data()?.plannedStagingLocationIds,
  });
}

const reapproveShell = shellDeliveryIdForImport("vii-dropoff-reapprove");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", reapproveShell), {
    id: reapproveShell,
    jobId: "job-1",
    vendorId: "vendor-1",
    orderNumber: "ORD-REAPPROVE",
    status: "pending",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: "vii-dropoff-reapprove",
    plannedStagingLocationIds: ["staging-dropoff-reapprove-g1"],
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});
let reapprove;
try {
  reapprove = await approveImport({
    vendorInvoiceImportId: "vii-dropoff-reapprove",
    action: "approve",
    plannedStagingLocationIds: ["staging-dropoff-reapprove-g2"],
  });
} catch (err) {
  fail("re-approve with replace staging failed", err?.message);
}
const reapproveSnap = await getDoc(doc(db, "deliveries", reapproveShell));
const reapprovePlanned = reapproveSnap.data()?.plannedStagingLocationIds ?? [];
if (
  reapprove?.data?.reviewStatus === "approved" &&
  reapprovePlanned.length === 1 &&
  reapprovePlanned[0] === "staging-dropoff-reapprove-g2"
) {
  pass("re-approve replaces plannedStagingLocationIds (no duplicates)");
} else {
  fail("re-approve replace semantics", reapprovePlanned);
}

console.log("\n=== CF: fulfillmentDecision on approve ===\n");

let fulfillDropOff;
try {
  fulfillDropOff = await approveImport({
    vendorInvoiceImportId: "vii-fulfill-dropoff",
    action: "approve",
    fulfillmentDecision: "delivery",
    plannedStagingLocationIds: ["staging-fulfill-dropoff-fd1"],
  });
} catch (err) {
  fail("fulfillmentDecision delivery approve failed", err?.message);
}
const fulfillDropOffShell = shellDeliveryIdForImport("vii-fulfill-dropoff");
const fulfillDropOffSnap = await getDoc(doc(db, "deliveries", fulfillDropOffShell));
if (
  fulfillDropOff?.data?.reviewStatus === "approved" &&
  fulfillDropOffSnap.data()?.invoiceFulfillmentMethod === "delivery" &&
  fulfillDropOffSnap.data()?.plannedStagingLocationIds?.[0] ===
    "staging-fulfill-dropoff-fd1"
) {
  pass("fulfillmentDecision delivery happy path writes staging");
} else {
  fail("fulfillmentDecision delivery", {
    response: fulfillDropOff?.data,
    delivery: fulfillDropOffSnap.data(),
  });
}

let fulfillWillCall;
try {
  fulfillWillCall = await approveImport({
    vendorInvoiceImportId: "vii-fulfill-willcall",
    action: "approve",
    fulfillmentDecision: "will_call_pickup",
    plannedStagingLocationIds: ["staging-fulfill-willcall-fw1"],
  });
} catch (err) {
  fail("fulfillmentDecision will-call approve failed", err?.message);
}
const fulfillWillCallShell = shellDeliveryIdForImport("vii-fulfill-willcall");
const fulfillWillCallSnap = await getDoc(doc(db, "deliveries", fulfillWillCallShell));
if (
  fulfillWillCall?.data?.reviewStatus === "approved" &&
  fulfillWillCallSnap.data()?.invoiceFulfillmentMethod === "will_call_pickup" &&
  (fulfillWillCallSnap.data()?.plannedStagingLocationIds ?? []).length === 0
) {
  pass("fulfillmentDecision will-call happy path ignores client staging ids");
} else {
  fail("fulfillmentDecision will-call", fulfillWillCallSnap.data());
}

console.log("\n=== CF: idempotent approve replay ===\n");

let idempotentFirst;
try {
  idempotentFirst = await approveImport({
    vendorInvoiceImportId: "vii-idempotent-retry",
    action: "approve",
    fulfillmentDecision: "delivery",
    plannedStagingLocationIds: ["staging-idempotent-retry-ir1"],
  });
} catch (err) {
  fail("idempotent first approve failed", err?.message);
}
const idempotentLogLen =
  (await getDoc(doc(db, "vendorInvoiceImports", "vii-idempotent-retry"))).data()
    ?.importDecisionLog?.length ?? 0;
let idempotentSecond;
try {
  idempotentSecond = await approveImport({
    vendorInvoiceImportId: "vii-idempotent-retry",
    action: "approve",
    fulfillmentDecision: "delivery",
    plannedStagingLocationIds: ["staging-idempotent-retry-ir1"],
  });
} catch (err) {
  fail("idempotent second approve failed", err?.message);
}
const idempotentLogLenAfter =
  (await getDoc(doc(db, "vendorInvoiceImports", "vii-idempotent-retry"))).data()
    ?.importDecisionLog?.length ?? 0;
if (
  idempotentSecond?.data?.idempotentReplay === true &&
  idempotentSecond?.data?.itemsApplied === 0 &&
  idempotentLogLenAfter === idempotentLogLen
) {
  pass("idempotent retry success — no duplicate log entries");
} else {
  fail("idempotent retry", {
    second: idempotentSecond?.data,
    logBefore: idempotentLogLen,
    logAfter: idempotentLogLenAfter,
  });
}

try {
  await approveImport({
    vendorInvoiceImportId: "vii-idempotent-contradict",
    action: "approve",
    fulfillmentDecision: "delivery",
    plannedStagingLocationIds: ["staging-idempotent-contradict-ic1"],
  });
} catch (err) {
  fail("contradict setup first approve failed", err?.message);
}
try {
  await approveImport({
    vendorInvoiceImportId: "vii-idempotent-contradict",
    action: "approve",
    fulfillmentDecision: "will_call_pickup",
    plannedStagingLocationIds: [],
  });
  fail("contradicting idempotent retry should fail");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (msg.includes("different fulfillment decision")) {
    pass("contradicting idempotent retry fails on fulfillment mismatch");
  } else {
    fail("expected contradicting fulfillment error", err?.message);
  }
}

console.log("\n=== CF: D-79 explicit approval override ===\n");

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  const overrideShell = shellDeliveryIdForImport("vii-override-d79");
  await setDoc(doc(adminDb, "deliveries", overrideShell), {
    id: overrideShell,
    jobId: "job-1",
    vendorId: "vendor-1",
    orderNumber: "ORD-OVERRIDE",
    status: "ready_for_pickup",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: "vii-override-d79",
    invoiceFulfillmentMethod: "will_call_pickup",
    invoiceImportStatus: "pickup_at_vendor",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});
let overrideApprove;
try {
  overrideApprove = await approveImport({
    vendorInvoiceImportId: "vii-override-d79",
    action: "approve",
    fulfillmentDecision: "delivery",
    plannedStagingLocationIds: ["staging-override-d79-od1"],
  });
} catch (err) {
  fail("D-79 explicit override approve failed", err?.message);
}
const overrideShellId = shellDeliveryIdForImport("vii-override-d79");
const overrideSnap = await getDoc(doc(db, "deliveries", overrideShellId));
if (
  overrideApprove?.data?.reviewStatus === "approved" &&
  overrideSnap.data()?.invoiceFulfillmentMethod === "delivery" &&
  overrideSnap.data()?.plannedStagingLocationIds?.[0] === "staging-override-d79-od1"
) {
  pass("explicit fulfillmentDecision override flips prior will-call (D-79 bypass)");
} else {
  fail("D-79 override result", overrideSnap.data());
}

console.log("\n=== CF: matched existing delivery on approve (D-67) ===\n");

/** Unique PO + order per case so match stays single-candidate (score ≥ 85). */
async function seedHighConfidenceMatchCase(adminDb, {
  importId,
  orderNumber,
  poNumber,
  fulfillmentMethod = "delivery",
  importStatus = "pending",
  deliveryExtras = {},
}) {
  const poId = `po-for-${importId}`;
  const deliveryId = `delivery-for-${importId}`;
  await setDoc(doc(adminDb, "purchaseOrders", poId), {
    id: poId,
    poNumber,
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "open",
    createdAt: "2026-06-02T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
  });
  await setDoc(doc(adminDb, "deliveries", deliveryId), {
    id: deliveryId,
    orderNumber,
    jobId: "job-1",
    vendorId: "vendor-1",
    purchaseOrderId: poId,
    status: "pending",
    notes: `Operational history for ${importId}`,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...deliveryExtras,
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", importId), {
    id: importId,
    inboundEmailProcessingId: `inbound-${importId}`,
    gmailMessageId: `msg-${importId}`,
    importBatchId: "batch-matched",
    pageId: `inv-${importId}`,
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus,
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: false,
    duplicate: false,
    parsedHeader: {
      ...dropOffHeader,
      customerPoOrReference: poNumber,
      vendorOrderNumber: orderNumber,
      vendorInvoiceNumber: orderNumber,
      // Clear inherited jobNumberRaw from `header` — matcher adds every job-1
      // delivery as a candidate and would force humanReviewRequired.
      jobNumberRaw: "",
      fulfillmentMethod,
    },
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
  return deliveryId;
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await seedScenarioStagingLocations(adminDb, "matched-a1", ["target", "reap"]);
  await seedScenarioStagingLocations(adminDb, "matched-a2", ["keep"]);
  await seedScenarioStagingLocations(adminDb, "matched-a3", ["old", "new"]);
  await seedScenarioStagingLocations(adminDb, "matched-a4", ["wc"]);
  await seedScenarioStagingLocations(adminDb, "matched-a5", ["x"]);
  await seedScenarioStagingLocations(adminDb, "matched-foreign", ["x"]);
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-matched-no-staging",
    orderNumber: "MATCH-ORD-A1",
    poNumber: "PO-80001",
    deliveryExtras: { notes: "Operational history A1" },
  });
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-matched-preserve-staging",
    orderNumber: "MATCH-ORD-A2",
    poNumber: "PO-80002",
    deliveryExtras: {
      plannedStagingLocationIds: ["staging-matched-a2-keep"],
      status: "arrived",
      notes: "Preserve me",
    },
  });
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-matched-change-staging",
    orderNumber: "MATCH-ORD-A3",
    poNumber: "PO-80003",
    deliveryExtras: {
      plannedStagingLocationIds: ["staging-matched-a3-old"],
      status: "arrived",
      notes: "Change staging",
    },
  });
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-matched-willcall",
    orderNumber: "MATCH-ORD-A4",
    poNumber: "PO-80004",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    deliveryExtras: {
      plannedStagingLocationIds: ["staging-matched-a4-wc"],
      stagingLocationId: "staging-matched-a4-wc",
      combinationStagingGroupId: "combo-wc",
      combinationMemberLocationIds: ["staging-matched-a4-wc"],
    },
  });
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-matched-malicious-id",
    orderNumber: "MATCH-ORD-A5",
    poNumber: "PO-80005",
  });

  // Foreign shell owns the only candidate for this order/PO → must fall back to own shell.
  await setDoc(doc(adminDb, "purchaseOrders", "po-foreign"), {
    id: "po-foreign",
    poNumber: "PO-80999",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "open",
    createdAt: "2026-06-02T00:00:00Z",
    updatedAt: "2026-06-02T00:00:00Z",
  });
  await setDoc(doc(adminDb, "deliveries", "delivery-foreign-shell"), {
    id: "delivery-foreign-shell",
    orderNumber: "MATCH-ORD-FOREIGN",
    jobId: "job-1",
    vendorId: "vendor-1",
    purchaseOrderId: "po-foreign",
    status: "pending",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: "vii-other-import-owner",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-match-foreign-shell"), {
    id: "vii-match-foreign-shell",
    inboundEmailProcessingId: "inbound-foreign",
    gmailMessageId: "msg-foreign",
    importBatchId: "batch-matched",
    pageId: "inv-foreign",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pending",
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: false,
    duplicate: false,
    parsedHeader: {
      ...dropOffHeader,
      customerPoOrReference: "PO-80999",
      vendorOrderNumber: "MATCH-ORD-FOREIGN",
      vendorInvoiceNumber: "MATCH-ORD-FOREIGN",
      jobNumberRaw: "",
      fulfillmentMethod: "delivery",
    },
    parsedLines: sampleLines,
    parsedLineCount: 2,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
});

let matchedNoStg;
try {
  matchedNoStg = await approveImport({
    vendorInvoiceImportId: "vii-matched-no-staging",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a1-target"],
  });
} catch (err) {
  fail("matched drop-off approve failed", err?.message);
}
const matchedTarget = "delivery-for-vii-matched-no-staging";
const matchedShell = shellDeliveryIdForImport("vii-matched-no-staging");
const matchedSnap = await getDoc(doc(db, "deliveries", matchedTarget));
const matchedShellSnap = await getDoc(doc(db, "deliveries", matchedShell));
if (
  matchedNoStg?.data?.reviewStatus === "approved" &&
  matchedNoStg?.data?.deliveryMatched === true &&
  matchedNoStg?.data?.shellCreated === false &&
  matchedNoStg?.data?.deliveryOrderId === matchedTarget &&
  matchedSnap.exists() &&
  matchedSnap.data()?.plannedStagingLocationIds?.[0] === "staging-matched-a1-target" &&
  matchedSnap.data()?.notes === "Operational history A1" &&
  matchedSnap.data()?.status === "pending" &&
  !matchedShellSnap.exists()
) {
  pass("matched drop-off updates existing delivery — no shell duplicate");
} else {
  fail("matched drop-off target/shell", {
    response: matchedNoStg?.data,
    existing: matchedSnap.data(),
    shellExists: matchedShellSnap.exists(),
  });
}

let matchedPreserve;
try {
  matchedPreserve = await approveImport({
    vendorInvoiceImportId: "vii-matched-preserve-staging",
    action: "approve",
    // omit plannedStagingLocationIds — preserve existing
  });
} catch (err) {
  fail("matched preserve staging approve failed", err?.message);
}
const preserveId = "delivery-for-vii-matched-preserve-staging";
const preserveSnap = await getDoc(doc(db, "deliveries", preserveId));
const preservePlanned = preserveSnap.data()?.plannedStagingLocationIds ?? [];
if (
  matchedPreserve?.data?.deliveryMatched === true &&
  preservePlanned.length === 1 &&
  preservePlanned[0] === "staging-matched-a2-keep" &&
  preserveSnap.data()?.notes === "Preserve me"
) {
  pass("matched drop-off preserves existing staging when omitted");
} else {
  fail("matched preserve staging", {
    response: matchedPreserve?.data,
    planned: preservePlanned,
    notes: preserveSnap.data()?.notes,
  });
}

let matchedChange;
try {
  matchedChange = await approveImport({
    vendorInvoiceImportId: "vii-matched-change-staging",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a3-new"],
  });
} catch (err) {
  fail("matched change staging approve failed", err?.message);
}
const changeId = "delivery-for-vii-matched-change-staging";
const changeSnap = await getDoc(doc(db, "deliveries", changeId));
const changePlanned = changeSnap.data()?.plannedStagingLocationIds ?? [];
if (
  matchedChange?.data?.deliveryMatched === true &&
  changePlanned.length === 1 &&
  changePlanned[0] === "staging-matched-a3-new" &&
  changeSnap.data()?.status === "arrived"
) {
  pass("matched drop-off replaces staging on existing delivery");
} else {
  fail("matched change staging", { planned: changePlanned, status: changeSnap.data()?.status });
}

let matchedWill;
try {
  matchedWill = await approveImport({
    vendorInvoiceImportId: "vii-matched-willcall",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a4-wc"],
  });
} catch (err) {
  fail("matched will-call approve failed", err?.message);
}
const willId = "delivery-for-vii-matched-willcall";
const willSnap = await getDoc(doc(db, "deliveries", willId));
const matchedWillPlanned = willSnap.data()?.plannedStagingLocationIds ?? [];
const matchedWillActual = willSnap.data()?.stagingLocationId ?? "";
const matchedWillCombo = willSnap.data()?.combinationStagingGroupId ?? "";
if (
  matchedWill?.data?.deliveryMatched === true &&
  Array.isArray(matchedWillPlanned) &&
  matchedWillPlanned.length === 0 &&
  matchedWillActual === "" &&
  matchedWillCombo === "" &&
  Array.isArray(willSnap.data()?.plannedLocationReleases) &&
  willSnap.data().plannedLocationReleases.some(
    (r) =>
      r?.locationId === "staging-matched-a4-wc" &&
      r?.reason === "fulfillment_switched_to_will_call",
  )
) {
  pass("matched will-call clears prior active staging + audit release");
} else {
  fail("matched will-call staging clear", {
    response: matchedWill?.data,
    planned: matchedWillPlanned,
    actual: matchedWillActual,
    combo: matchedWillCombo,
    releases: willSnap.data()?.plannedLocationReleases,
  });
}

// Matched non-shell Will-Call: first approve ignores client staging; retry with
// same staging ids must still idempotentReplay (not staging-mismatch fail).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await seedScenarioStagingLocations(adminDb, "idempotent-matched-wc", ["mw1"]);
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-idempotent-matched-wc",
    orderNumber: "MATCH-WC-IDEM",
    poNumber: "PO-IDEM-WC",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    deliveryExtras: {
      plannedStagingLocationIds: ["staging-idempotent-matched-wc-mw1"],
      stagingLocationId: "staging-idempotent-matched-wc-mw1",
      status: "arrived",
      notes: "Matched Will-Call idempotent",
    },
  });
});
let matchedWcFirst;
try {
  matchedWcFirst = await approveImport({
    vendorInvoiceImportId: "vii-idempotent-matched-wc",
    action: "approve",
    fulfillmentDecision: "will_call_pickup",
    plannedStagingLocationIds: ["staging-idempotent-matched-wc-mw1"],
  });
} catch (err) {
  fail("matched will-call first approve failed", err?.message);
}
let matchedWcSecond;
try {
  matchedWcSecond = await approveImport({
    vendorInvoiceImportId: "vii-idempotent-matched-wc",
    action: "approve",
    fulfillmentDecision: "will_call_pickup",
    plannedStagingLocationIds: ["staging-idempotent-matched-wc-mw1"],
  });
} catch (err) {
  fail("matched will-call idempotent retry failed", err?.message);
}
const matchedWcDeliveryId = "delivery-for-vii-idempotent-matched-wc";
if (
  matchedWcFirst?.data?.deliveryMatched === true &&
  matchedWcSecond?.data?.idempotentReplay === true &&
  matchedWcSecond?.data?.deliveryOrderId === matchedWcDeliveryId
) {
  pass("matched will-call + staging ids idempotent retry succeeds");
} else {
  fail("matched will-call idempotent", {
    first: matchedWcFirst?.data,
    second: matchedWcSecond?.data,
  });
}

try {
  await approveImport({
    vendorInvoiceImportId: "vii-matched-malicious-id",
    action: "approve",
    deliveryOrderId: "delivery-unrelated-malicious",
    plannedStagingLocationIds: ["staging-matched-a5-x"],
  });
  fail("malicious deliveryOrderId should be rejected");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (msg.includes("does not match the server-resolved") || msg.includes("invalid-argument")) {
    pass("malicious/unrelated deliveryOrderId rejected server-side");
  } else {
    fail("expected malicious id rejection", err?.message);
  }
}

let foreignFallthrough;
try {
  foreignFallthrough = await approveImport({
    vendorInvoiceImportId: "vii-match-foreign-shell",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-foreign-x"],
  });
} catch (err) {
  fail("foreign-shell candidate should fall back to own shell", err?.message);
}
const foreignShellId = shellDeliveryIdForImport("vii-match-foreign-shell");
const foreignExisting = await getDoc(doc(db, "deliveries", "delivery-foreign-shell"));
const foreignOwnShell = await getDoc(doc(db, "deliveries", foreignShellId));
if (
  foreignFallthrough?.data?.deliveryMatched !== true &&
  foreignFallthrough?.data?.deliveryOrderId === foreignShellId &&
  foreignOwnShell.exists() &&
  foreignExisting.data()?.vendorInvoiceImportId === "vii-other-import-owner"
) {
  pass("foreign invoice shell candidate excluded — falls back to own shell");
} else {
  fail("foreign shell exclusion", {
    response: foreignFallthrough?.data,
    foreignOwner: foreignExisting.data()?.vendorInvoiceImportId,
    ownExists: foreignOwnShell.exists(),
  });
}

// Re-approve matched: reject then reopen then approve again — same target, no shell
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(
    doc(adminDb, "vendorInvoiceImports", "vii-matched-no-staging"),
    {
      reviewStatus: "rejected",
      rejectedAt: "2026-06-25T00:00:00Z",
      rejectedBy: "system",
      // keep linkedDeliveryOrderId from prior approve
    },
    { merge: true },
  );
});
// reopen system path may block manual reject — set pending directly for re-approve identity test
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(
    doc(adminDb, "vendorInvoiceImports", "vii-matched-no-staging"),
    {
      reviewStatus: "pending_review",
      rejectedAt: null,
      rejectedBy: null,
    },
    { merge: true },
  );
});
let matchedReapprove;
try {
  matchedReapprove = await approveImport({
    vendorInvoiceImportId: "vii-matched-no-staging",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a1-reap"],
  });
} catch (err) {
  fail("matched re-approve failed", err?.message);
}
const reMatchedSnap = await getDoc(doc(db, "deliveries", matchedTarget));
const reMatchedShell = await getDoc(doc(db, "deliveries", matchedShell));
if (
  matchedReapprove?.data?.deliveryOrderId === matchedTarget &&
  reMatchedSnap.data()?.plannedStagingLocationIds?.[0] === "staging-matched-a1-reap" &&
  reMatchedSnap.data()?.notes === "Operational history A1" &&
  !reMatchedShell.exists()
) {
  pass("matched re-approve keeps same delivery — no shell, no history wipe");
} else {
  fail("matched re-approve identity", {
    response: matchedReapprove?.data,
    notes: reMatchedSnap.data()?.notes,
    shellExists: reMatchedShell.exists(),
  });
}

// D-79 + D-80: Will-Call-parsed import must not wipe dispatcher Drop-Off staging.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await seedScenarioStagingLocations(adminDb, "matched-a14", ["drop"]);
  await seedHighConfidenceMatchCase(adminDb, {
    importId: "vii-matched-preserve-dropoff-vs-willcall-import",
    orderNumber: "MATCH-ORD-A14",
    poNumber: "PO-80014",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    deliveryExtras: {
      invoiceFulfillmentMethod: "delivery",
      invoiceImportStatus: "pending",
      plannedStagingLocationIds: ["staging-matched-a14-drop"],
      stagingLocationId: "staging-matched-a14-drop",
      status: "arrived",
      notes: "Keep Drop-Off staging",
    },
  });
});
let matchedPreserveDropOff;
try {
  matchedPreserveDropOff = await approveImport({
    vendorInvoiceImportId: "vii-matched-preserve-dropoff-vs-willcall-import",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a14-drop"],
  });
} catch (err) {
  fail("preserve Drop-Off vs Will-Call import approve failed", err?.message);
}
const preserveDropOffId =
  "delivery-for-vii-matched-preserve-dropoff-vs-willcall-import";
const preserveDropOffVsWillSnap = await getDoc(
  doc(db, "deliveries", preserveDropOffId),
);
const preserveDropOffVsWill = preserveDropOffVsWillSnap.data() ?? {};
const preserveDropOffVsWillPlanned =
  preserveDropOffVsWill.plannedStagingLocationIds ?? [];
if (
  matchedPreserveDropOff?.data?.deliveryMatched === true &&
  preserveDropOffVsWill.invoiceFulfillmentMethod === "delivery" &&
  Array.isArray(preserveDropOffVsWillPlanned) &&
  preserveDropOffVsWillPlanned[0] === "staging-matched-a14-drop" &&
  preserveDropOffVsWill.stagingLocationId === "staging-matched-a14-drop"
) {
  pass(
    "Will-Call import approve does not clear dispatcher Drop-Off staging (D-79)",
  );
} else {
  fail("preserve Drop-Off staging wiped by Will-Call import", {
    response: matchedPreserveDropOff?.data,
    fulfillment: preserveDropOffVsWill.invoiceFulfillmentMethod,
    planned: preserveDropOffVsWillPlanned,
    actual: preserveDropOffVsWill.stagingLocationId,
  });
}

// priorLinked sticky to a delivery claimed by another import → reject at commit (D-38)
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "deliveries", "delivery-claimed-by-other"), {
    id: "delivery-claimed-by-other",
    orderNumber: "CLAIMED-ORD-1",
    jobId: "job-1",
    vendorId: "vendor-1",
    status: "pending",
    vendorInvoiceImportId: "vii-other-claimant",
    notes: "Owned by other import",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-prior-linked-foreign"), {
    id: "vii-prior-linked-foreign",
    inboundEmailProcessingId: "inbound-prior-foreign",
    gmailMessageId: "msg-prior-foreign",
    importBatchId: "batch-matched",
    pageId: "inv-prior-foreign",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pending",
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: false,
    duplicate: false,
    linkedDeliveryOrderId: "delivery-claimed-by-other",
    parsedHeader: {
      ...dropOffHeader,
      customerPoOrReference: "PO-80998",
      vendorOrderNumber: "CLAIMED-ORD-1",
      vendorInvoiceNumber: "CLAIMED-ORD-1",
      jobNumberRaw: "",
      fulfillmentMethod: "delivery",
    },
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
    vendorInvoiceImportId: "vii-prior-linked-foreign",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a4-wc"],
  });
  fail("priorLinked foreign-owned delivery should be rejected");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (/already linked to another invoice/i.test(msg) || String(err?.code ?? "").includes("failed-precondition")) {
    pass("priorLinked foreign-owned delivery rejected at commit (TOCTOU guard)");
  } else {
    fail("expected foreign ownership failed-precondition", err?.message);
  }
}
const claimedAfter = await getDoc(doc(db, "deliveries", "delivery-claimed-by-other"));
if (claimedAfter.data()?.vendorInvoiceImportId === "vii-other-claimant" && claimedAfter.data()?.notes === "Owned by other import") {
  pass("foreign-owned delivery unchanged after blocked priorLinked approve");
} else {
  fail("foreign delivery mutated", claimedAfter.data());
}

// Case 10 — legacy duplicate Review approve redirects to canonical delivery (no second shell)
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendors", "vendor-1"), {
    id: "vendor-1",
    name: "Johnstone Supply",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(adminDb, "jobs", "job-biz-canon"), {
    id: "job-biz-canon",
    jobNumber: "26-BIZ",
    jobName: "Biz Idempotency",
    status: "active",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(adminDb, "deliveries", "delivery-vii-vii-biz-canon-page-1"), {
    id: "delivery-vii-vii-biz-canon-page-1",
    orderNumber: "BIZ-INV-100",
    jobId: "job-biz-canon",
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    status: "pending",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: "vii-biz-canon-page-1",
    vendorInvoiceNumber: "BIZ-INV-100",
    plannedStagingLocationIds: ["staging-matched-a4-wc"],
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-biz-canon-page-1"), {
    id: "vii-biz-canon-page-1",
    inboundEmailProcessingId: "inbound-biz-canon",
    gmailMessageId: "msg-biz-canon",
    importBatchId: "batch-biz-canon",
    pageId: "page-1",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    importStatus: "pending",
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: false,
    duplicate: false,
    linkedDeliveryOrderId: "delivery-vii-vii-biz-canon-page-1",
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    parsedHeader: {
      ...dropOffHeader,
      vendorInvoiceNumber: "BIZ-INV-100",
      vendorOrderNumber: "BIZ-INV-100",
      customerPoOrReference: "PO-BIZ-100",
      fulfillmentMethod: "delivery",
    },
    parsedLines: sampleLines,
    parsedLineCount: sampleLines.length,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-06-24T10:05:00Z",
    approvedBy: "tester",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:05:00Z",
  });
  await setDoc(doc(adminDb, "vendorBusinessInvoiceKeys", "key:johnstone-supply__BIZ-INV-100"), {
    vendorScope: "key:johnstone-supply",
    vendorKey: "johnstone-supply",
    normalizedInvoiceNumber: "BIZ-INV-100",
    canonicalImportId: "vii-biz-canon-page-1",
    canonicalGmailMessageId: "msg-biz-canon",
    contentFingerprint: "testhash",
    createdAt: "2026-06-24T10:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-biz-dup-page-1"), {
    id: "vii-biz-dup-page-1",
    inboundEmailProcessingId: "inbound-biz-dup",
    gmailMessageId: "msg-biz-dup",
    importBatchId: "batch-biz-dup",
    pageId: "page-1",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pending",
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: true,
    duplicate: false,
    canonicalImportId: "vii-biz-canon-page-1",
    skipReason: "duplicate_business_invoice",
    rejectedAt: "2026-06-24T11:00:00Z",
    rejectedBy: "system:duplicate_business_invoice",
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    parsedHeader: {
      ...dropOffHeader,
      vendorInvoiceNumber: "BIZ-INV-100",
      vendorOrderNumber: "BIZ-INV-100",
      customerPoOrReference: "PO-BIZ-100",
      fulfillmentMethod: "delivery",
    },
    parsedLines: sampleLines,
    parsedLineCount: sampleLines.length,
    parseWarnings: [],
    orderNotes: [],
    outcome: "skipped",
    createdAt: "2026-06-24T11:00:00Z",
    updatedAt: "2026-06-24T11:00:00Z",
  });
});

try {
  const dupApprove = await approveImport({
    vendorInvoiceImportId: "vii-biz-dup-page-1",
    action: "approve",
    plannedStagingLocationIds: ["staging-matched-a4-wc"],
  });
  const dupData = dupApprove?.data ?? dupApprove;
  if (dupData?.deliveryOrderId === "delivery-vii-vii-biz-canon-page-1") {
    pass("legacy duplicate Review approve redirects to canonical delivery (no second shell)");
  } else {
    fail("legacy duplicate approve should target canonical delivery", dupData);
  }
} catch (err) {
  fail("legacy duplicate approve failed", err?.message);
}

const canonStamp = await getDoc(
  doc(db, "deliveries", "delivery-vii-vii-biz-canon-page-1"),
);
if (canonStamp.data()?.vendorInvoiceImportId === "vii-biz-canon-page-1") {
  pass("canonical delivery ownership stamp preserved after duplicate approve");
} else {
  fail("canonical ownership stamp stolen", canonStamp.data());
}

const dupShell = await getDoc(
  doc(db, "deliveries", "delivery-vii-vii-biz-dup-page-1"),
);
if (!dupShell.exists()) {
  pass("no second shell delivery-vii-vii-biz-dup-page-1 created");
} else {
  fail("second shell was created for duplicate import", dupShell.data());
}

// Case 11 — legacy import+delivery, NO key doc: approve of new pending same invoice
// redirects to legacy delivery (first post-deploy resend gap).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "vendors", "vendor-1"), {
    id: "vendor-1",
    name: "Johnstone Supply",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(adminDb, "jobs", "job-biz-nokey"), {
    id: "job-biz-nokey",
    jobNumber: "26-NOKEY",
    jobName: "Biz No Key",
    status: "active",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  });
  await setDoc(doc(adminDb, "deliveries", "delivery-vii-vii-biz-nokey-legacy-page-1"), {
    id: "delivery-vii-vii-biz-nokey-legacy-page-1",
    orderNumber: "BIZ-NOKEY-1",
    jobId: "job-biz-nokey",
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    status: "pending",
    createdFromInvoiceImport: true,
    vendorInvoiceImportId: "vii-biz-nokey-legacy-page-1",
    vendorInvoiceNumber: "BIZ-NOKEY-1",
    plannedStagingLocationIds: ["staging-matched-a4-wc"],
    createdAt: "2026-08-08T18:48:10Z",
    updatedAt: "2026-08-08T18:48:10Z",
  });
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-biz-nokey-legacy-page-1"), {
    id: "vii-biz-nokey-legacy-page-1",
    inboundEmailProcessingId: "inbound-biz-nokey-legacy",
    gmailMessageId: "msg-biz-nokey-legacy",
    importBatchId: "batch-biz-nokey-legacy",
    pageId: "page-1",
    pageIndexInBatch: 0,
    reviewStatus: "approved",
    importStatus: "pending",
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: false,
    duplicate: false,
    linkedDeliveryOrderId: "delivery-vii-vii-biz-nokey-legacy-page-1",
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    parsedHeader: {
      ...dropOffHeader,
      vendorInvoiceNumber: "BIZ-NOKEY-1",
      vendorOrderNumber: "BIZ-NOKEY-1",
      customerPoOrReference: "PO-BIZ-NOKEY",
      fulfillmentMethod: "delivery",
    },
    parsedLines: sampleLines,
    parsedLineCount: sampleLines.length,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    approvedAt: "2026-08-08T18:50:00Z",
    approvedBy: "tester",
    createdAt: "2026-08-08T18:48:10Z",
    updatedAt: "2026-08-08T18:50:00Z",
  });
  // Intentionally NO vendorBusinessInvoiceKeys doc.
  await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-biz-nokey-resend-page-1"), {
    id: "vii-biz-nokey-resend-page-1",
    inboundEmailProcessingId: "inbound-biz-nokey-resend",
    gmailMessageId: "msg-biz-nokey-resend",
    importBatchId: "batch-biz-nokey-resend",
    pageId: "page-1",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pending",
    confidenceTier: "high",
    confidenceScore: 90,
    humanReviewRequired: true,
    duplicate: false,
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    parsedHeader: {
      ...dropOffHeader,
      vendorInvoiceNumber: "BIZ-NOKEY-1",
      vendorOrderNumber: "BIZ-NOKEY-1",
      customerPoOrReference: "PO-BIZ-NOKEY",
      fulfillmentMethod: "delivery",
    },
    parsedLines: sampleLines,
    parsedLineCount: sampleLines.length,
    parseWarnings: [],
    orderNotes: [],
    outcome: "needs_review",
    createdAt: "2026-08-29T12:00:00Z",
    updatedAt: "2026-08-29T12:00:00Z",
  });
});

try {
  const nokeyApprove = await approveImport({
    vendorInvoiceImportId: "vii-biz-nokey-resend-page-1",
    action: "approve",
  });
  const nokeyData = nokeyApprove?.data ?? nokeyApprove;
  if (nokeyData?.deliveryOrderId === "delivery-vii-vii-biz-nokey-legacy-page-1") {
    pass("no-key legacy resend approve redirects to legacy delivery");
  } else {
    fail("no-key legacy approve should target legacy delivery", nokeyData);
  }
} catch (err) {
  fail("no-key legacy approve failed", err?.message);
}

const nokeyDupShell = await getDoc(
  doc(db, "deliveries", "delivery-vii-vii-biz-nokey-resend-page-1"),
);
if (!nokeyDupShell.exists()) {
  pass("no second shell for no-key legacy resend approve");
} else {
  fail("second shell created for no-key resend", nokeyDupShell.data());
}

await testEnv.cleanup();

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("test-approve-vendor-invoice-import: PASS");
