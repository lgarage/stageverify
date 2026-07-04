/**
 * retryOnError path — Firestore emulator coverage.
 * Proves error docs are atomically overwritten (never deleted) and reprocessed.
 *
 * Usage: npm run test:retry-on-error-inbound
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const EMULATOR_ONLY = process.env.RETRY_ON_ERROR_EMULATOR_ONLY === "1";

if (!process.env.FIRESTORE_EMULATOR_HOST && !EMULATOR_ONLY) {
  console.log("Spawning Firestore emulator for retryOnError tests…\n");
  const inner = `node scripts/test-retry-on-error-inbound.mjs`;
  const child = spawnSync(`firebase emulators:exec --only firestore "${inner}"`, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, RETRY_ON_ERROR_EMULATOR_ONLY: "1" },
  });
  process.exit(child.status ?? 1);
}

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

const admin = require("../functions/node_modules/firebase-admin");
const { processInboundGmailMessage } = require("../functions/lib/inboundEmail/processInboundGmailMessage.js");

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

const NO_PDF_MESSAGE = {
  id: "msg-retry-no-pdf",
  threadId: "thread-retry-1",
  internalDate: String(Date.parse("2026-06-24T10:00:00Z")),
  payload: {
    headers: [
      { name: "From", value: "billing@vendor.com" },
      { name: "Subject", value: "No attachment email" },
    ],
    parts: [{ mimeType: "text/plain", body: { data: "No PDF here." } }],
  },
};

async function readDoc(docId) {
  const snap = await db.collection(COLLECTION).doc(docId).get();
  return snap.exists ? snap.data() : null;
}

async function testErrorDocSkippedWithoutRetry() {
  console.log("\n1. Error doc skipped when retryOnError=false");
  const gmailMessageId = "msg-skip-error";
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();

  await db.collection(COLLECTION).doc(docId).set({
    id: docId,
    gmailMessageId,
    senderEmail: "billing@vendor.com",
    subject: "Failed invoice",
    receivedAt: ts,
    attachmentFilenames: [],
    pdfAttachments: [],
    processingStatus: "error",
    processingError: "Previous failure",
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
  });

  const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
    prefetchedMessage: NO_PDF_MESSAGE,
  });

  if (result.skipped === true) pass("skipped without retryOnError");
  else fail("skipped without retryOnError", { skipped: result.skipped });

  if (result.skippedProcessingStatus === "error") pass("skipped status is error");
  else fail("skipped status is error", { status: result.skippedProcessingStatus });

  const inDb = await readDoc(docId);
  if (inDb?.processingStatus === "error") pass("error doc unchanged in Firestore");
  else fail("error doc unchanged in Firestore", { status: inDb?.processingStatus });
}

async function testRetryOnErrorOverwritesAtomically() {
  console.log("\n2. retryOnError atomically overwrites error doc (no delete gap)");
  const gmailMessageId = NO_PDF_MESSAGE.id;
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();

  await db.collection(COLLECTION).doc(docId).set({
    id: docId,
    gmailMessageId,
    senderEmail: "billing@vendor.com",
    subject: "Failed invoice",
    receivedAt: ts,
    attachmentFilenames: ["old.pdf"],
    pdfAttachments: [],
    processingStatus: "error",
    processingError: "PDF text extraction failed",
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
  });

  const before = await readDoc(docId);
  if (before?.processingStatus === "error") pass("seeded error doc exists");
  else fail("seeded error doc exists", { status: before?.processingStatus });

  const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
    retryOnError: true,
    prefetchedMessage: NO_PDF_MESSAGE,
  });

  if (result.skipped === false) pass("not skipped with retryOnError");
  else fail("not skipped with retryOnError", { skipped: result.skipped });

  if (result.processingStatus === "no_pdf") pass("reprocessed to no_pdf");
  else fail("reprocessed to no_pdf", { status: result.processingStatus });

  const after = await readDoc(docId);
  if (after?.processingStatus === "no_pdf") pass("Firestore doc is no_pdf after retry");
  else fail("Firestore doc is no_pdf after retry", { status: after?.processingStatus });

  if (!after?.processingError) pass("processingError cleared on successful retry");
  else fail("processingError cleared on successful retry", { error: after.processingError });
}

async function main() {
  console.log("test-retry-on-error-inbound (Firestore emulator)\n");

  await testErrorDocSkippedWithoutRetry();
  await testRetryOnErrorOverwritesAtomically();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
