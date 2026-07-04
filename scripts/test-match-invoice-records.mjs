/**
 * matchInvoiceToRecords — offline unit + emulator callable smoke.
 * Usage: node scripts/test-match-invoice-records.mjs
 *        npm run test:match-invoice-records (wraps emulators:exec)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
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
import {
  extractPoHint,
  matchInvoiceToRecords,
} from "../functions/lib/invoice/matchInvoiceToRecords.js";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const EMULATOR_ONLY = process.env.MATCH_INVOICE_EMULATOR_ONLY === "1";

if (!process.env.FIRESTORE_EMULATOR_HOST && !EMULATOR_ONLY) {
  console.log("Spawning Firebase emulators for matchInvoiceToRecords tests…\n");
  const inner = `node scripts/test-match-invoice-records.mjs`;
  const child = spawnSync(
    `firebase emulators:exec --only auth,firestore,functions "${inner}"`,
    {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, MATCH_INVOICE_EMULATOR_ONLY: "1" },
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

console.log("\n=== Unit: matchInvoiceToRecords (offline) ===\n");

if (extractPoHint("PLANET FITNESS PICKUP PO-88390 extra") === "PO-88390") {
  pass("extractPoHint finds PO token in customer reference");
} else {
  fail("extractPoHint PO token");
}

const mockCtx = {
  vendors: [{ id: "vendor-1", email: "billing@johnstonesupply.com" }],
  jobs: [{ id: "job-1", jobNumber: "26-1042" }],
  purchaseOrders: [
    { id: "po-demo-vendor-1", poNumber: "PO-88390", jobId: "job-1", vendorId: "vendor-1" },
  ],
  deliveries: [
    {
      id: "delivery-demo-vendor-1",
      orderNumber: "ORD-005",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-demo-vendor-1",
    },
  ],
};

const headerPlanetFitness = {
  customerAccountNumber: "0018114",
  vendorOrderNumber: "6164159",
  vendorInvoiceNumber: "6164159",
  customerPoOrReference: "PLANET FITNESS PICKUP PO-88390",
  orderDate: "2026-06-23",
  invoiceDate: "2026-06-23",
  shipDate: "2026-06-23",
  vendorBranchName: "Johnstone Supply",
  vendorBranchAddress: "335 N Weber Ave, Sioux Falls SD 57103",
  vendorBranchPhone: "605-338-2652",
  soldToName: "TWIN PILLAR HEATING & COOLING",
  shipToName: "TWIN PILLAR HEATING & COOLING",
  shipToAddress: "2944 HOLMGREN WAY, GREEN BAY WI 54304",
  fulfillmentMethod: "will_call_pickup",
  shipCompletePolicy: "unknown",
};

const notesMap = new Map([
  [
    "delivery-demo-vendor-1",
    "Email ingest: Johnstone will-call SO#6164159 — Customer P/O PLANET FITNESS PICKUP",
  ],
]);

const offlineMatch = matchInvoiceToRecords(
  "vii-test-6164159",
  headerPlanetFitness,
  mockCtx,
  notesMap,
);

if (offlineMatch.candidates.some((c) => c.deliveryId === "delivery-demo-vendor-1")) {
  pass("offline match finds ORD-005 candidate");
} else {
  fail("offline match missing delivery-demo-vendor-1", offlineMatch.candidates);
}

if (offlineMatch.purchaseOrderId === "po-demo-vendor-1") {
  pass("offline match resolves PO-88390");
} else {
  fail("offline match PO", offlineMatch.purchaseOrderId);
}

if (offlineMatch.humanReviewRequired === false || offlineMatch.candidates.length === 1) {
  pass("single candidate or review flag set");
} else {
  fail("unexpected multi-candidate offline", offlineMatch);
}

console.log("\n=== CF: matchInvoiceToRecordsCallable (emulators) ===\n");

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

const matchInvoice = httpsCallable(functions, "matchInvoiceToRecordsCallable");

async function seedEmulatorData() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, "jobs", "job-1"), {
      id: "job-1",
      jobNumber: "26-1042",
      jobName: "Planet Fitness",
    });
    await setDoc(doc(adminDb, "vendors", "vendor-1"), {
      id: "vendor-1",
      name: "Johnstone Supply",
      email: "billing@johnstonesupply.com",
    });
    await setDoc(doc(adminDb, "purchaseOrders", "po-demo-vendor-1"), {
      id: "po-demo-vendor-1",
      poNumber: "PO-88390",
      jobId: "job-1",
      vendorId: "vendor-1",
      status: "open",
    });
    await setDoc(doc(adminDb, "deliveries", "delivery-demo-vendor-1"), {
      id: "delivery-demo-vendor-1",
      orderNumber: "ORD-005",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-demo-vendor-1",
      status: "pending",
      notes:
        "Email ingest: Johnstone will-call SO#6164159 — Customer P/O PLANET FITNESS PICKUP",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    await setDoc(doc(adminDb, "vendorInvoiceImports", "vii-emulator-6164159"), {
      id: "vii-emulator-6164159",
      inboundEmailProcessingId: "inbound-test",
      gmailMessageId: "msg-test",
      importBatchId: "batch-test",
      pageId: "inv-6164159",
      pageIndexInBatch: 0,
      reviewStatus: "pending_review",
      importStatus: "pickup_at_vendor",
      confidenceTier: "medium",
      confidenceScore: 70,
      humanReviewRequired: true,
      duplicate: false,
      parsedHeader: headerPlanetFitness,
      parsedLines: [],
      parsedLineCount: 2,
      parseWarnings: [],
      orderNotes: [],
      outcome: "needs_review",
      createdAt: "2026-06-24T10:00:00Z",
      updatedAt: "2026-06-24T10:00:00Z",
    });
  });
}

await seedEmulatorData();

try {
  await matchInvoice({ vendorInvoiceImportId: "vii-emulator-6164159" });
  fail("unauthenticated matchInvoiceToRecords should be denied");
} catch (err) {
  const code = String(err?.code ?? err?.message ?? "");
  if (code.includes("unauthenticated") || code.includes("permission")) {
    pass("unauthenticated call denied");
  } else {
    fail("expected unauthenticated denial", err?.message);
  }
}

try {
  await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
} catch {
  await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
}

let cfResult;
try {
  cfResult = await matchInvoice({ vendorInvoiceImportId: "vii-emulator-6164159" });
} catch (err) {
  fail("authenticated matchInvoiceToRecords call failed", err?.message);
}

const cfData = cfResult?.data ?? {};
if (Array.isArray(cfData.candidates) && cfData.candidates.length >= 1) {
  pass("CF returns delivery candidates");
} else {
  fail("CF candidates missing", cfData);
}

if (
  cfData.candidates?.some((c) => c.deliveryId === "delivery-demo-vendor-1") ||
  cfData.deliveryOrderId === "delivery-demo-vendor-1"
) {
  pass("CF matched delivery-demo-vendor-1");
} else {
  fail("CF wrong delivery match", cfData);
}

if (cfData.humanReviewRequired !== undefined) {
  pass("CF returns humanReviewRequired flag");
} else {
  fail("CF missing humanReviewRequired");
}

await testEnv.cleanup();

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("test-match-invoice-records: PASS");
