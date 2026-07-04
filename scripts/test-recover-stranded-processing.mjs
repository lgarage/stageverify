/**
 * recoverStrandedInboundProcessing — Firestore emulator TOCTOU coverage.
 * Proves completed/parsed records are not overwritten when recovery runs with a stale
 * "processing" snapshot, and that truly stranded processing docs are marked error.
 *
 * Usage: npm run test:recover-stranded-processing
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const EMULATOR_ONLY = process.env.RECOVER_STRANDED_EMULATOR_ONLY === "1";

if (!process.env.FIRESTORE_EMULATOR_HOST && !EMULATOR_ONLY) {
  console.log("Spawning Firestore emulator for stranded-processing recovery tests…\n");
  const inner = `node scripts/test-recover-stranded-processing.mjs`;
  const child = spawnSync(`firebase emulators:exec --only firestore "${inner}"`, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, RECOVER_STRANDED_EMULATOR_ONLY: "1" },
  });
  process.exit(child.status ?? 1);
}

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

const admin = require("../functions/node_modules/firebase-admin");
const {
  recoverStrandedInboundProcessing,
  recoverStrandedInboundProcessingList,
  STRANDED_PROCESSING_MS,
} = require("../functions/lib/inboundEmail/recoverStrandedProcessing.js");

const PROJECT_ID = "stageverify-db";
const COLLECTION = "inboundEmailProcessing";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();

let passed = 0;
let failed = 0;

function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, detail) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

function staleIso() {
  return new Date(Date.now() - STRANDED_PROCESSING_MS - 60_000).toISOString();
}

function freshIso() {
  return new Date().toISOString();
}

function makeDoc(id, overrides = {}) {
  const ts = staleIso();
  return {
    id,
    gmailMessageId: `gmail-${id}`,
    senderEmail: "billing@vendor.com",
    subject: "Invoice test",
    receivedAt: ts,
    attachmentFilenames: [],
    pdfAttachments: [],
    processingStatus: "processing",
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

async function seedDoc(doc) {
  await db.collection(COLLECTION).doc(doc.id).set(doc);
}

async function readDoc(id) {
  const snap = await db.collection(COLLECTION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function testCompletedNotOverwritten() {
  console.log("\n1. TOCTOU — completed parse not overwritten by stale processing snapshot");
  const id = "recover-toctou-parsed";
  const completed = makeDoc(id, {
    processingStatus: "parsed",
    parseResult: {
      importBatchId: "batch-toctou-1",
      processed: 0,
      needsReview: 1,
      failed: 0,
      total: 1,
      reviewRecordIds: ["review-1"],
    },
  });
  await seedDoc(completed);

  const staleSnapshot = makeDoc(id, { processingStatus: "processing" });
  const result = await recoverStrandedInboundProcessing(staleSnapshot);
  const inDb = await readDoc(id);

  if (result.processingStatus === "parsed") pass("return value stays parsed");
  else fail("return value stays parsed", { got: result.processingStatus });

  if (inDb?.processingStatus === "parsed") pass("Firestore doc stays parsed");
  else fail("Firestore doc stays parsed", { got: inDb?.processingStatus });

  if (!inDb?.processingError) pass("no processingError written on completed doc");
  else fail("no processingError written on completed doc", { error: inDb.processingError });
}

async function testExtractedNotOverwritten() {
  console.log("\n2. TOCTOU — extracted status not overwritten");
  const id = "recover-toctou-extracted";
  const extracted = makeDoc(id, { processingStatus: "extracted" });
  await seedDoc(extracted);

  const staleSnapshot = makeDoc(id, { processingStatus: "processing" });
  const result = await recoverStrandedInboundProcessing(staleSnapshot);
  const inDb = await readDoc(id);

  if (result.processingStatus === "extracted") pass("return value stays extracted");
  else fail("return value stays extracted", { got: result.processingStatus });

  if (inDb?.processingStatus === "extracted") pass("Firestore doc stays extracted");
  else fail("Firestore doc stays extracted", { got: inDb?.processingStatus });
}

async function testStrandedProcessingRecovered() {
  console.log("\n3. Stranded processing doc recovered to error");
  const id = "recover-stranded-processing";
  const stranded = makeDoc(id, { processingStatus: "processing" });
  await seedDoc(stranded);

  const result = await recoverStrandedInboundProcessing({ ...stranded });
  const inDb = await readDoc(id);

  if (result.processingStatus === "error") pass("return value is error");
  else fail("return value is error", { got: result.processingStatus });

  if (typeof result.processingError === "string" && result.processingError.length > 0) {
    pass("return value includes processingError");
  } else fail("return value includes processingError");

  if (inDb?.processingStatus === "error") pass("Firestore doc marked error");
  else fail("Firestore doc marked error", { got: inDb?.processingStatus });
}

async function testFreshProcessingNotRecovered() {
  console.log("\n4. Fresh processing doc (< threshold) left unchanged");
  const id = "recover-fresh-processing";
  const ts = freshIso();
  const fresh = makeDoc(id, {
    processingStatus: "processing",
    createdAt: ts,
    updatedAt: ts,
  });
  await seedDoc(fresh);

  const result = await recoverStrandedInboundProcessing({ ...fresh });
  const inDb = await readDoc(id);

  if (result.processingStatus === "processing") pass("return value stays processing");
  else fail("return value stays processing", { got: result.processingStatus });

  if (inDb?.processingStatus === "processing") pass("Firestore doc stays processing");
  else fail("Firestore doc stays processing", { got: inDb?.processingStatus });
}

async function testListMixedBatch() {
  console.log("\n5. recoverStrandedInboundProcessingList handles mixed batch");
  const parsedId = "recover-list-parsed";
  const strandedId = "recover-list-stranded";

  await seedDoc(
    makeDoc(parsedId, {
      processingStatus: "parsed",
      parseResult: {
        importBatchId: "batch-list",
        processed: 0,
        needsReview: 1,
        failed: 0,
        total: 1,
        reviewRecordIds: [],
      },
    }),
  );
  await seedDoc(makeDoc(strandedId, { processingStatus: "processing" }));

  const staleParsed = makeDoc(parsedId, { processingStatus: "processing" });
  const stranded = makeDoc(strandedId, { processingStatus: "processing" });

  const results = await recoverStrandedInboundProcessingList([staleParsed, stranded]);
  const parsedResult = results.find((d) => d.id === parsedId);
  const strandedResult = results.find((d) => d.id === strandedId);

  if (parsedResult?.processingStatus === "parsed") pass("list: parsed doc unchanged");
  else fail("list: parsed doc unchanged", { got: parsedResult?.processingStatus });

  if (strandedResult?.processingStatus === "error") pass("list: stranded doc recovered");
  else fail("list: stranded doc recovered", { got: strandedResult?.processingStatus });
}

async function main() {
  console.log("test-recover-stranded-processing (Firestore emulator)\n");

  await testCompletedNotOverwritten();
  await testExtractedNotOverwritten();
  await testStrandedProcessingRecovered();
  await testFreshProcessingNotRecovered();
  await testListMixedBatch();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
