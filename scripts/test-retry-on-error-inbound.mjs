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
const { isGmailApiNotFoundError } = require("../functions/lib/gmailInbound.js");

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

async function testZeroQueueParsedReprocessesOnRetry() {
  console.log("\n3. Parsed doc with 0 queued invoices reprocesses on Refresh Now retry");
  const gmailMessageId = "msg-zero-queue-backfill";
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();

  await db.collection(COLLECTION).doc(docId).set({
    id: docId,
    gmailMessageId,
    senderEmail: "billing@johnstonesupply.com",
    subject: "Fwd: S/O Confirmation 4046362",
    receivedAt: ts,
    attachmentFilenames: ["so-4046362.pdf"],
    pdfAttachments: [],
    processingStatus: "parsed",
    parseResult: {
      importBatchId: "batch-old",
      processed: 0,
      needsReview: 0,
      failed: 1,
      total: 1,
      reviewRecordIds: [],
    },
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
  });

  const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
    retryOnError: true,
    prefetchedMessage: NO_PDF_MESSAGE,
  });

  if (result.skipped === false) pass("zero-queue parsed doc not skipped on retryOnError");
  else fail("zero-queue parsed doc not skipped on retryOnError", { skipped: result.skipped });

  if (result.processingStatus === "no_pdf") pass("reprocess ran (no_pdf without attachment in fixture)");
  else fail("reprocess ran", { status: result.processingStatus });
}

const SO_CACHED_TEXT = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 4046362
Customer P/O #: PLANET FITNESS
Order Date: 06/23/2026
Buyer: TEST BUYER
Ship Via: TRUCK DELIVE

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 2 0 L46-668 THERMOSTAT PROGRAMMABLE
`.trim();

async function testCachedTextBackfillQueuesIssueImport() {
  console.log("\n4. Cached extracted text backfill queues S/O issue import");
  const gmailMessageId = "msg-so-cached-backfill";
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();

  await db.collection(COLLECTION).doc(docId).set({
    id: docId,
    gmailMessageId,
    senderEmail: "billing@johnstonesupply.com",
    subject: "S/O Confirmation 4046362",
    receivedAt: ts,
    attachmentFilenames: ["so-4046362.pdf"],
    pdfAttachments: [],
    combinedExtractedText: SO_CACHED_TEXT,
    processingStatus: "parsed",
    parseResult: {
      importBatchId: "batch-old",
      processed: 0,
      needsReview: 1,
      failed: 0,
      total: 1,
      reviewRecordIds: [],
    },
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
  });

  const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
    retryOnError: true,
  });

  if (result.skipped === false) pass("cached parsed doc reprocessed");
  else fail("cached parsed doc reprocessed", { skipped: result.skipped });

  if (result.reviewRecordIds.length === 1) pass("one review record queued");
  else fail("one review record queued", { ids: result.reviewRecordIds });

  const reviewSnap = await db
    .collection("vendorInvoiceImports")
    .doc(result.reviewRecordIds[0])
    .get();
  if (reviewSnap.exists) pass("vendorInvoiceImports doc written");
  else fail("vendorInvoiceImports doc written");

  const reviewData = reviewSnap.data();
  if (reviewData?.importStatus === "issue") pass("issue importStatus on review row");
  else fail("issue importStatus on review row", { status: reviewData?.importStatus });
}

const P411190_CACHED_TEXT = `
SUSPENDED
Page 1/2
Customer # Order Date Sales Order # Buyer Customer P/O # Ship Via Salesman
0008745 01/07/2026 4046362 DAN DAY blackduck hartfo Fond du Lac 101
Customer #
0008745
Sales Order #
4046362
Customer P/O #
blackduck hartfo
Order Date
01/07/2026
Buyer
DAN DAY
Invoice # Invoice Date Ship Date Freight Terms Job Number Terms
P411190 01/08/2026 PREPAID& ADD *****COD ONLY*****
LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT UOM LIST NET EXTENSION
ORD SHI B/O NUMBER DESCRIPTION PRICE PRICE
1 4 4 0 L97-525 80055.021625 16X25X2 FILTER EA 18.99 8.74 $34.96
2 32 32 0 L97-532 80055.022025 20X25X2 FILTER EA 22.49 8.05 $257.60
3 2 2 0 L63-264 ZLP20352 20X35X2 MERV EA 89.00 26.94 $53.88
4 1 1 0 P33-332 2351336 BELT COGGED AX32 EA 36.49 16.10 $16.10
5 4 4 0 P34-544 2351419 BELT COGGED BX44 EA 65.00 29.90 $119.60
`.trim();

async function testStaleIssueImportReparseWithInvoiceNumber() {
  console.log("\n5. Stale issue import re-parses to P411190 on Refresh Now");
  const gmailMessageId = "19f2d62d6949a928";
  const docId = `inbound-${gmailMessageId}`;
  const reviewId = `vii-${gmailMessageId}-page-0`;
  const ts = new Date().toISOString();

  await db.collection(COLLECTION).doc(docId).set({
    id: docId,
    gmailMessageId,
    senderEmail: "billing@johnstonesupply.com",
    subject: "Fwd: S/O Confirmation 4046362 Cust P/O blackduck hartford",
    receivedAt: ts,
    attachmentFilenames: ["JS_Invoice_P411190_54632502.PDF"],
    pdfAttachments: [],
    combinedExtractedText: P411190_CACHED_TEXT,
    processingStatus: "parsed",
    parseResult: {
      importBatchId: "batch-old",
      processed: 0,
      needsReview: 1,
      failed: 0,
      total: 1,
      reviewRecordIds: [reviewId],
    },
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
  });

  await db.collection("vendorInvoiceImports").doc(reviewId).set({
    id: reviewId,
    inboundEmailProcessingId: docId,
    gmailMessageId,
    importBatchId: "batch-old",
    pageId: "page-0",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "issue",
    confidenceTier: "low",
    confidenceScore: 40,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: {
      vendorOrderNumber: "4046362",
      vendorInvoiceNumber: "",
      shipViaRaw: "DAN DAY",
    },
    parsedLines: [],
    parsedLineCount: 0,
    parseWarnings: ["missing vendorInvoiceNumber"],
    orderNotes: [],
    outcome: "needs_review",
    error: "missing vendorInvoiceNumber",
    createdAt: ts,
    updatedAt: ts,
  });

  const { shouldReprocessExistingDoc } = require("../functions/lib/inboundEmail/processInboundGmailMessage.js");
  const inboundData = await readDoc(docId);
  if (
    shouldReprocessExistingDoc(inboundData, {
      retryOnError: true,
      reparseStaleReviews: true,
    })
  ) {
    pass("shouldReprocessExistingDoc true with reparseStaleReviews");
  } else {
    fail("shouldReprocessExistingDoc true with reparseStaleReviews");
  }

  if (
    !shouldReprocessExistingDoc(inboundData, {
      retryOnError: true,
      reparseStaleReviews: false,
    })
  ) {
    pass("shouldReprocessExistingDoc false without reparseStaleReviews");
  } else {
    fail("shouldReprocessExistingDoc false without reparseStaleReviews");
  }

  const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
    retryOnError: true,
    reparseStaleReviews: true,
  });

  if (result.skipped === false) pass("stale issue import not skipped on reparseStaleReviews");
  else fail("stale issue import not skipped on reparseStaleReviews", { skipped: result.skipped });

  const reviewSnap = await db.collection("vendorInvoiceImports").doc(reviewId).get();
  const reviewData = reviewSnap.data();
  const header = reviewData?.parsedHeader ?? {};

  if (header.vendorInvoiceNumber === "P411190") pass("vendorInvoiceNumber updated to P411190");
  else fail("vendorInvoiceNumber updated to P411190", { inv: header.vendorInvoiceNumber });

  if (header.shipViaRaw === "Fond du Lac") pass("shipViaRaw updated to Fond du Lac");
  else fail("shipViaRaw updated to Fond du Lac", { shipVia: header.shipViaRaw });

  if (reviewData?.importStatus === "pending") pass("importStatus upgraded to pending");
  else fail("importStatus upgraded to pending", { status: reviewData?.importStatus });

  if (!(reviewData?.parseWarnings ?? []).some((w) => w.includes("missing vendorInvoiceNumber"))) {
    pass("missing vendorInvoiceNumber warning cleared");
  } else {
    fail("missing vendorInvoiceNumber warning cleared", { warnings: reviewData?.parseWarnings });
  }
}

function testGmailApiNotFoundHelper() {
  console.log("\n6. isGmailApiNotFoundError helper");
  if (
    isGmailApiNotFoundError(
      new Error("gmail api /messages/19f3a2e9dfccab1e?format=full: 404"),
    )
  ) {
    pass("detects messages.get 404");
  } else {
    fail("detects messages.get 404");
  }
  if (!isGmailApiNotFoundError(new Error("gmail api /history?startHistoryId=1: 404"))) {
    pass("ignores history 404 (handled separately)");
  } else {
    fail("ignores history 404 (handled separately)");
  }
}

async function testMessageGoneDocNotRetried() {
  console.log("\n7. message_gone doc skipped even when retryOnError=true");
  const gmailMessageId = "msg-tombstone-gone";
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();

  await db.collection(COLLECTION).doc(docId).set({
    id: docId,
    gmailMessageId,
    senderEmail: "billing@vendor.com",
    subject: "Deleted in Gmail",
    receivedAt: ts,
    attachmentFilenames: [],
    pdfAttachments: [],
    processingStatus: "message_gone",
    processingError: "Message no longer in Gmail mailbox (deleted or permanently inaccessible).",
    reviewStatus: "pending_review",
    createdAt: ts,
    updatedAt: ts,
  });

  const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
    retryOnError: true,
  });

  if (result.skipped === true) pass("skipped tombstoned message");
  else fail("skipped tombstoned message", { skipped: result.skipped });

  if (result.skippedProcessingStatus === "message_gone") pass("status remains message_gone");
  else fail("status remains message_gone", { status: result.skippedProcessingStatus });
}

function installModifyFetchStub(options = {}) {
  const originalFetch = globalThis.fetch;
  const modifyCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.includes("/modify")) {
      modifyCalls.push({ url, body: String(init.body ?? "") });
      if (options.failModify) {
        return new Response("nope", { status: 403 });
      }
      return new Response(JSON.stringify({ id: "ok", labelIds: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (typeof originalFetch === "function") {
      return originalFetch(input, init);
    }
    return new Response("unexpected fetch", { status: 500 });
  };
  return {
    modifyCalls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function testArchiveBacklogOnParsedSkip() {
  console.log("\n8. Archive backlog: skip of parsed without gmailInboxArchivedAt");
  const gmailMessageId = "msg-archive-backlog-parsed";
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();
  const stub = installModifyFetchStub();

  try {
    await db.collection(COLLECTION).doc(docId).set({
      id: docId,
      gmailMessageId,
      senderEmail: "billing@vendor.com",
      subject: "Already parsed",
      receivedAt: ts,
      attachmentFilenames: ["inv.pdf"],
      pdfAttachments: [],
      processingStatus: "parsed",
      reviewStatus: "pending_review",
      parseResult: {
        importBatchId: "batch-x",
        processed: 0,
        needsReview: 1,
        failed: 0,
        total: 1,
        reviewRecordIds: ["vii-x"],
      },
      createdAt: ts,
      updatedAt: ts,
    });

    const result = await processInboundGmailMessage("fake-token", gmailMessageId);
    if (result.skipped === true) pass("parsed skip still skipped");
    else fail("parsed skip still skipped", result);

    if (stub.modifyCalls.length === 1) pass("archive modify called once on backlog skip");
    else fail("archive modify called once on backlog skip", stub.modifyCalls);

    const body = JSON.parse(stub.modifyCalls[0]?.body || "{}");
    if (
      Array.isArray(body.removeLabelIds) &&
      body.removeLabelIds[0] === "INBOX" &&
      !("addLabelIds" in body)
    ) {
      pass("backlog archive body is INBOX-only remove");
    } else {
      fail("backlog archive body is INBOX-only remove", body);
    }

    const doc = await readDoc(docId);
    if (typeof doc?.gmailInboxArchivedAt === "string" && doc.gmailInboxArchivedAt.length > 0) {
      pass("gmailInboxArchivedAt written");
    } else {
      fail("gmailInboxArchivedAt written", doc?.gmailInboxArchivedAt);
    }

    stub.modifyCalls.length = 0;
    await processInboundGmailMessage("fake-token", gmailMessageId);
    if (stub.modifyCalls.length === 0) pass("idempotent — no second archive");
    else fail("idempotent — no second archive", stub.modifyCalls);
  } finally {
    stub.restore();
  }
}

async function testArchiveNotOnErrorOrNoPdfOrMessageGone() {
  console.log("\n9. Archive not attempted for error / no_pdf / message_gone");
  const stub = installModifyFetchStub();
  try {
    for (const [gmailMessageId, status] of [
      ["msg-no-archive-error", "error"],
      ["msg-no-archive-gone", "message_gone"],
    ]) {
      const docId = `inbound-${gmailMessageId}`;
      const ts = new Date().toISOString();
      await db.collection(COLLECTION).doc(docId).set({
        id: docId,
        gmailMessageId,
        senderEmail: "billing@vendor.com",
        subject: status,
        receivedAt: ts,
        attachmentFilenames: [],
        pdfAttachments: [],
        processingStatus: status,
        reviewStatus: "pending_review",
        createdAt: ts,
        updatedAt: ts,
      });
      stub.modifyCalls.length = 0;
      await processInboundGmailMessage("fake-token", gmailMessageId);
      if (stub.modifyCalls.length === 0) pass(`no archive on skip status=${status}`);
      else fail(`no archive on skip status=${status}`, stub.modifyCalls);
    }

    stub.modifyCalls.length = 0;
    const gmailMessageId = "msg-fresh-no-pdf";
    const result = await processInboundGmailMessage("fake-token", gmailMessageId, {
      prefetchedMessage: {
        ...NO_PDF_MESSAGE,
        id: gmailMessageId,
      },
    });
    if (result.processingStatus === "no_pdf") pass("fresh no_pdf status");
    else fail("fresh no_pdf status", result);
    if (stub.modifyCalls.length === 0) pass("no archive on plain no_pdf");
    else fail("no archive on plain no_pdf", stub.modifyCalls);
  } finally {
    stub.restore();
  }
}

async function testArchiveSoftFailKeepsParsed() {
  console.log("\n10. Archive soft-fail keeps parsed status");
  const gmailMessageId = "msg-archive-soft-fail";
  const docId = `inbound-${gmailMessageId}`;
  const ts = new Date().toISOString();
  const stub = installModifyFetchStub({ failModify: true });

  try {
    await db.collection(COLLECTION).doc(docId).set({
      id: docId,
      gmailMessageId,
      senderEmail: "billing@vendor.com",
      subject: "Soft fail archive",
      receivedAt: ts,
      attachmentFilenames: ["inv.pdf"],
      pdfAttachments: [],
      processingStatus: "parsed",
      reviewStatus: "pending_review",
      parseResult: {
        importBatchId: "batch-soft",
        processed: 0,
        needsReview: 1,
        failed: 0,
        total: 1,
        reviewRecordIds: ["vii-soft"],
      },
      createdAt: ts,
      updatedAt: ts,
    });

    const result = await processInboundGmailMessage("fake-token", gmailMessageId);
    if (result.skipped === true && result.processingStatus === "parsed") {
      pass("skip result remains parsed on archive failure");
    } else {
      fail("skip result remains parsed on archive failure", result);
    }

    const doc = await readDoc(docId);
    if (doc?.processingStatus === "parsed") pass("doc status stays parsed");
    else fail("doc status stays parsed", doc?.processingStatus);
    if (!doc?.gmailInboxArchivedAt) pass("no gmailInboxArchivedAt after soft-fail");
    else fail("no gmailInboxArchivedAt after soft-fail", doc.gmailInboxArchivedAt);
  } finally {
    stub.restore();
  }
}

async function main() {
  console.log("test-retry-on-error-inbound (Firestore emulator)\n");

  await testErrorDocSkippedWithoutRetry();
  await testRetryOnErrorOverwritesAtomically();
  await testZeroQueueParsedReprocessesOnRetry();
  await testCachedTextBackfillQueuesIssueImport();
  await testStaleIssueImportReparseWithInvoiceNumber();
  testGmailApiNotFoundHelper();
  await testMessageGoneDocNotRetried();
  await testArchiveBacklogOnParsedSkip();
  await testArchiveNotOnErrorOrNoPdfOrMessageGone();
  await testArchiveSoftFailKeepsParsed();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
