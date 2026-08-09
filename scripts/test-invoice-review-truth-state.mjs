/**
 * Lane C C2 — truth-state consistency regression (exact 2205 EARLY sequence).
 * Deterministic mocked model + in-memory Firestore.
 *
 * Usage: npm run test:invoice-review-truth-state
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib", "invoice", "reviewChat");
const inboundLib = path.join(
  __dirname,
  "..",
  "functions",
  "lib",
  "inboundEmail",
);

const context = await import(
  pathToFileURL(path.join(libRoot, "reviewAgentContext.js")).href
);
const turnMod = await import(
  pathToFileURL(path.join(libRoot, "runReviewAgentTurn.js")).href
);
const applyMod = await import(
  pathToFileURL(path.join(libRoot, "applyInvoiceReviewFieldCorrection.js")).href
);
const reconcileMod = await import(
  pathToFileURL(path.join(libRoot, "reconcileAfterFieldCorrection.js")).href
);
const gateMod = await import(
  pathToFileURL(path.join(libRoot, "correctionStateGate.js")).href
);
const auditMod = await import(
  pathToFileURL(path.join(libRoot, "correctionAuditRecovery.js")).href
);
const promptMod = await import(
  pathToFileURL(path.join(libRoot, "reviewAgentPrompt.js")).href
);

const EXTRACTED = `
JOHNSTONE SUPPLY
INVOICE 6169414
Customer P/O # 2205 EARLY PICKUP SAD
SHIP VIA: OUR TRUCK
---PDF ATTACHMENT---
INVOICE 6169474
Customer P/O # truck stock PICKUP SAD
`.trim();

const TARGET_PO = "2205 EARLY";
const PAGE1 = "vii-truth-page-1";
const PAGE2 = "vii-truth-page-2";
const INBOUND = "inbound-truth-batch";

function ok(label) {
  console.log(`PASS: ${label}`);
}

/** In-memory Firestore with where(field, "==", value) for audit recovery. */
function createMemoryDb(seed = {}) {
  const store = new Map();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, structuredClone(v));
  }

  function pathOf(...parts) {
    return parts.join("/");
  }

  function makeDocRef(fullPath) {
    return {
      id: fullPath.split("/").pop(),
      path: fullPath,
      async get() {
        const data = store.get(fullPath);
        return {
          exists: data !== undefined,
          id: this.id,
          data: () => (data === undefined ? undefined : structuredClone(data)),
          ref: this,
        };
      },
      async set(data, opts) {
        if (opts?.merge && store.has(fullPath)) {
          store.set(fullPath, { ...store.get(fullPath), ...structuredClone(data) });
        } else {
          store.set(fullPath, structuredClone(data));
        }
      },
      async update(data) {
        if (!store.has(fullPath)) throw new Error(`missing ${fullPath}`);
        const cur = store.get(fullPath);
        const next = { ...cur };
        for (const [k, v] of Object.entries(data)) {
          if (k.includes(".")) {
            const [a, b] = k.split(".");
            next[a] = { ...(next[a] ?? {}), [b]: v };
          } else {
            next[k] = v;
          }
        }
        store.set(fullPath, next);
      },
      collection(sub) {
        return makeCollection(`${fullPath}/${sub}`);
      },
    };
  }

  function makeCollection(basePath) {
    const api = {
      doc(id) {
        const docId =
          id ?? `auto_${Math.random().toString(36).slice(2)}_${store.size}`;
        return makeDocRef(pathOf(basePath, docId));
      },
      where(field, op, value) {
        return {
          async get() {
            if (op !== "==") throw new Error(`unsupported where ${op}`);
            const prefix = `${basePath}/`;
            const docs = [...store.entries()]
              .filter(
                ([k]) =>
                  k.startsWith(prefix) && !k.slice(prefix.length).includes("/"),
              )
              .filter(([, v]) => v?.[field] === value)
              .map(([k, v]) => ({
                id: k.slice(prefix.length),
                data: () => structuredClone(v),
                ref: makeDocRef(k),
              }));
            return { empty: docs.length === 0, docs };
          },
        };
      },
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        const prefix = `${basePath}/`;
        const docs = [...store.entries()]
          .filter(
            ([k]) =>
              k.startsWith(prefix) && !k.slice(prefix.length).includes("/"),
          )
          .map(([k, v]) => ({
            id: k.slice(prefix.length),
            data: () => structuredClone(v),
            ref: makeDocRef(k),
          }));
        docs.sort((a, b) => {
          const at = String(a.data().createdAt ?? "");
          const bt = String(b.data().createdAt ?? "");
          return bt.localeCompare(at);
        });
        return { docs, empty: docs.length === 0 };
      },
    };
    return api;
  }

  return {
    _store: store,
    collection(name) {
      return makeCollection(name);
    },
    batch() {
      const ops = [];
      return {
        update(ref, data) {
          ops.push(() => ref.update(data));
        },
        async commit() {
          for (const op of ops) await op();
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          void ref.set(data);
        },
        update(ref, data) {
          void ref.update(data);
        },
      };
      return fn(tx);
    },
  };
}

function seedPageImports(db) {
  db._store.set(`inboundEmailProcessing/${INBOUND}`, {
    id: INBOUND,
    gmailMessageId: "truth-batch",
    combinedExtractedText: EXTRACTED,
    processingStatus: "parsed",
  });
  db._store.set(`vendorInvoiceImports/${PAGE1}`, {
    id: PAGE1,
    inboundEmailProcessingId: INBOUND,
    gmailMessageId: "truth-batch",
    pageId: "page-1",
    pageIndexInBatch: 0,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceScore: 80,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: {
      customerPoOrReference: "",
      vendorInvoiceNumber: "6169414",
      vendorOrderNumber: "SO-1",
    },
    parsedLines: [],
    parsedLineCount: 0,
    parseWarnings: ["missing customerPoOrReference", "uncertain:shipVia"],
    reviewRequiredReasons: ["Missing Customer P/O", "Parse warnings (1)"],
    orderNotes: [],
    stagingLocationIds: ["Z1"],
    linkedDeliveryOrderId: null,
  });
  db._store.set(`vendorInvoiceImports/${PAGE2}`, {
    id: PAGE2,
    inboundEmailProcessingId: INBOUND,
    gmailMessageId: "truth-batch",
    pageId: "page-2",
    pageIndexInBatch: 1,
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceScore: 90,
    humanReviewRequired: true,
    duplicate: false,
    parsedHeader: {
      customerPoOrReference: TARGET_PO,
      vendorInvoiceNumber: "6169474",
      vendorOrderNumber: "SO-2",
    },
    parsedLines: [],
    parsedLineCount: 0,
    parseWarnings: [],
    reviewRequiredReasons: ["Parser flagged human review required"],
    orderNotes: [],
    fieldCorrectionLog: [
      {
        field: "customerPoOrReference",
        previousValue: "truck stock",
        newValue: TARGET_PO,
        at: "2026-08-09T04:00:00.000Z",
        correctionId: "page2-corr",
      },
    ],
    originalParsedHeader: {
      customerPoOrReference: "truck stock",
      vendorInvoiceNumber: "6169474",
    },
    originalParseWarnings: [],
  });
  db._store.set(`vendorInvoiceImportChats/${PAGE1}`, {
    vendorInvoiceImportId: PAGE1,
    turnCount: 0,
    rollingSummary: "",
  });
  db._store.set(`vendorInvoiceImportChats/${PAGE2}`, {
    vendorInvoiceImportId: PAGE2,
    turnCount: 0,
    rollingSummary: "",
  });
}

// --- Gate unit: blank claim rewritten when current PO is set ---
{
  const gated = gateMod.reconcileAuthoritativeCorrectionState({
    answerText:
      "The parser currently reports customerPoOrReference as blank, resulting in the missing customerPoOrReference warning. 2205 EARLY is not present in the provided evidence windows.",
    citations: [{ sourceType: "parser_value", text: "missing customerPoOrReference" }],
    actionType: "answer",
    parsedHeader: { customerPoOrReference: TARGET_PO },
    fieldCorrectionLog: [
      {
        field: "customerPoOrReference",
        previousValue: "",
        newValue: TARGET_PO,
      },
    ],
    combinedExtractedText: EXTRACTED,
  });
  assert.equal(gated.consistencyCorrected, true);
  assert.match(gated.answerText, /Current authoritative Customer PO is 2205 EARLY/i);
  assert.doesNotMatch(
    gated.answerText,
    /reports customerPoOrReference as blank|currently reports.*blank/i,
  );
  ok("correctionStateGate rewrites stale blank/missing claims");
}

// --- Seed windows include PO even when dispatcher asks "why missing" ---
{
  const seeds = context.seedTermsFromAuthoritativeState({
    parsedHeader: { customerPoOrReference: TARGET_PO },
    fieldCorrectionLog: [
      { field: "customerPoOrReference", newValue: TARGET_PO },
    ],
  });
  const windows = context.extractTextWindows(
    EXTRACTED,
    "why is the PO missing / error missing customerPoOrReference",
    seeds,
  );
  assert.ok(
    windows.some((w) => /2205\s+EARLY/i.test(w.text)),
    "seeded windows must include 2205 EARLY evidence",
  );
  ok("extractTextWindows seeds authoritative PO for why-missing turns");
}

// --- Full conversational sequence (page-1) ---
{
  const db = createMemoryDb();
  seedPageImports(db);
  const page2Before = structuredClone(db._store.get(`vendorInvoiceImports/${PAGE2}`));

  // 1) Dispatcher asks to capture PO → propose
  const proposeTurn = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: PAGE1,
    message: "Reparse it and capture that PO — update Customer PO to 2205 EARLY.",
    generateJson: async () => ({
      actionType: "suggest_correction_may_be_needed",
      answerText:
        "I found 2205 EARLY in the invoice. I can update Customer PO to 2205 EARLY after you confirm.",
      citations: [
        { sourceType: "document_evidence", text: "2205 EARLY" },
      ],
      proposedCorrection: {
        field: "customerPoOrReference",
        currentValue: "",
        proposedValue: TARGET_PO,
      },
    }),
  });
  assert.ok(proposeTurn.agentMessage.proposedCorrection);
  assert.equal(
    proposeTurn.agentMessage.proposedCorrection.proposedValue,
    TARGET_PO,
  );
  assert.equal(
    proposeTurn.agentMessage.proposedCorrection.sourceType,
    "document_evidence",
  );
  assert.equal(proposeTurn.autoApplyEligible, true);
  assert.equal(proposeTurn.autoApplyTriggerMode, "chat_direct_command");
  const proposalMessageId = proposeTurn.autoApplyMessageId;
  assert.ok(proposalMessageId);
  ok("direct command proposes document_evidence correction");

  // 2) Apply
  const applyResult = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: PAGE1,
    sourceMessageId: proposalMessageId,
    idempotencyKey: "truth-k1",
    triggerMode: "chat_direct_command",
  });
  assert.equal(applyResult.applied, true);
  assert.equal(applyResult.newValue, TARGET_PO);
  assert.equal(applyResult.parsedHeader.customerPoOrReference, TARGET_PO);
  assert.ok(!applyResult.parseWarnings.includes("missing customerPoOrReference"));
  assert.ok(applyResult.parseWarnings.includes("uncertain:shipVia"));
  assert.ok(
    !(applyResult.reviewRequiredReasons ?? []).some((r) =>
      /Missing Customer P\/O/i.test(r),
    ),
  );
  const afterApply = db._store.get(`vendorInvoiceImports/${PAGE1}`);
  assert.equal(afterApply.parsedHeader.customerPoOrReference, TARGET_PO);
  assert.equal(afterApply.originalParsedHeader.customerPoOrReference, "");
  assert.ok(
    afterApply.originalParseWarnings.includes("missing customerPoOrReference"),
  );
  assert.equal(afterApply.fieldCorrectionLog.length, 1);
  // Phase 1: truth-state seed keeps uncertain:shipVia → other blocker remains, so
  // stale confidence/HRR may still list — assert Missing PO is gone (A clean-path
  // covered in test-auto-import-eligibility / test-invoice-field-correction).
  assert.ok(
    !(applyResult.reviewRequiredReasons ?? []).some((r) =>
      /Missing Customer P\/O/i.test(r),
    ),
  );
  ok("apply writes authoritative PO + clears current warnings + keeps history");

  // 3) Next turn wrongly claims blank — gate must rewrite
  const follow = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: PAGE1,
    message:
      "i dont see the po and i still see error missing customerPoOrReference",
    generateJson: async () => ({
      actionType: "answer",
      answerText:
        "The parser currently reports customerPoOrReference as blank, resulting in the missing customerPoOrReference warning. Although a previous turn mentioned 2205 EARLY, it is not present in the provided document evidence windows.",
      citations: [
        { sourceType: "parser_value", text: "missing customerPoOrReference" },
      ],
    }),
  });
  assert.match(
    follow.agentMessage.text,
    /Current authoritative Customer PO is 2205 EARLY/i,
  );
  assert.doesNotMatch(follow.agentMessage.text, /reports customerPoOrReference as blank/i);
  assert.doesNotMatch(follow.agentMessage.text, /I cannot change or apply/i);

  const packet = context.buildReviewAgentContextPacket({
    parsedHeader: afterApply.parsedHeader,
    parsedLines: afterApply.parsedLines,
    parseWarnings: afterApply.parseWarnings,
    reviewRequiredReasons: afterApply.reviewRequiredReasons,
    combinedExtractedText: EXTRACTED,
    recentTurns: [],
    rollingSummary: "",
    dispatcherMessage:
      "i dont see the po and i still see error missing customerPoOrReference",
    originalParsedHeader: afterApply.originalParsedHeader,
    fieldCorrectionLog: afterApply.fieldCorrectionLog,
    originalParseWarnings: afterApply.originalParseWarnings,
  });
  assert.ok(packet.fieldCorrectionLog?.length);
  assert.equal(packet.originalParsedHeader?.customerPoOrReference, "");
  assert.ok(packet.textWindows.some((w) => /2205\s+EARLY/i.test(w.text)));
  ok("next-turn truth-state + seeded evidence + ORIGINAL vs CURRENT in packet");

  // 4) Confirmation path positive — exactly one valid pending proposal
  function clearProposed(exceptId) {
    for (const [k, v] of db._store.entries()) {
      if (
        k.startsWith(`vendorInvoiceImportChats/${PAGE1}/messages/`) &&
        v?.correctionStatus === "proposed" &&
        k !== exceptId
      ) {
        v.correctionStatus = "superseded";
      }
    }
  }
  clearProposed(null);
  const pendingInvPath = `vendorInvoiceImportChats/${PAGE1}/messages/pending-inv`;
  db._store.set(pendingInvPath, {
    role: "agent",
    text: "Propose invoice",
    createdAt: new Date().toISOString(),
    correctionStatus: "proposed",
    proposedCorrection: {
      field: "vendorInvoiceNumber",
      currentValue: "6169414",
      proposedValue: "6169414",
      sourceType: "document_evidence",
    },
  });

  const confirm = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: PAGE1,
    message: "Yes, apply it.",
    generateJson: async () => ({
      actionType: "answer",
      answerText:
        "I cannot change or apply corrections myself. Please use the application interface.",
      citations: [],
    }),
  });
  assert.match(confirm.agentMessage.text, /^Confirmed\. Applying Invoice # → /);
  assert.doesNotMatch(confirm.agentMessage.text, /cannot change|cannot apply/i);
  assert.equal(confirm.autoApplyEligible, true);
  assert.equal(confirm.autoApplyTriggerMode, "chat_confirmation");
  ok("confirmation rewrite + autoApply gated on valid pending correction");

  // 5) Confirmation negative — malformed pending (empty proposedValue)
  clearProposed(null);
  const pendingBadPath = `vendorInvoiceImportChats/${PAGE1}/messages/pending-bad`;
  db._store.set(pendingBadPath, {
    role: "agent",
    text: "bad",
    createdAt: new Date().toISOString(),
    correctionStatus: "proposed",
    proposedCorrection: {
      field: "customerPoOrReference",
      currentValue: "",
      proposedValue: "",
      sourceType: "document_evidence",
    },
  });

  const confirmBad = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: PAGE1,
    message: "Yes, apply it.",
    generateJson: async () => ({
      actionType: "answer",
      answerText: "I cannot change or apply corrections myself.",
      citations: [],
    }),
  });
  assert.equal(Boolean(confirmBad.autoApplyEligible), false);
  assert.match(confirmBad.agentMessage.text, /incomplete or invalid/i);
  assert.doesNotMatch(confirmBad.agentMessage.text, /^Confirmed\. Applying/);
  ok("invalid pending proposal does not auto-apply");
  // 6) Refresh/reparse preserves correction log
  const parserBlank = {
    customerPoOrReference: "",
    vendorInvoiceNumber: "6169414",
    vendorOrderNumber: "SO-1",
  };
  const restoredHeader = reconcileMod.applyFieldCorrectionLogToHeader(
    parserBlank,
    afterApply.fieldCorrectionLog,
  );
  assert.equal(restoredHeader.customerPoOrReference, TARGET_PO);
  const restoredState = reconcileMod.reconcileImportStateAfterCorrection({
    parsedHeader: {
      ...restoredHeader,
      orderDate: "2026-01-01",
      customerAccountNumber: "12345",
      vendorBranchName: "Johnstone Supply",
      buyerName: "Acme HVAC",
    },
    parseWarnings: ["missing customerPoOrReference"],
    importStatus: "pickup_at_vendor",
    confidenceScore: 80,
    humanReviewRequired: true,
    duplicate: false,
    parserFormatId: "johnstone",
    parsedLines: [
      {
        lineType: "product",
        excludeFromExpectedItems: false,
        quantityOrdered: 1,
        quantityShipped: 1,
        quantityBackordered: 0,
      },
    ],
    parsedLineCount: 1,
    fieldCorrectionLog: afterApply.fieldCorrectionLog,
  });
  assert.ok(!restoredState.parseWarnings.includes("missing customerPoOrReference"));
  assert.equal(restoredState.importDecisionMode, "suggested_import");
  assert.equal(restoredState.autoImportConfidence, 80);
  assert.ok(
    !restoredState.reviewRequiredReasons.some((r) =>
      /Parser confidence|human review required/i.test(r),
    ),
  );
  ok("reparse re-applies fieldCorrectionLog (Refresh preserve; no stale veto)");

  // 7) Audit recovery when log wiped
  const wiped = structuredClone(afterApply);
  delete wiped.fieldCorrectionLog;
  wiped.parsedHeader = { ...parserBlank };
  wiped.parseWarnings = ["missing customerPoOrReference"];
  db._store.set(`vendorInvoiceImports/${PAGE1}`, wiped);
  // Audit already written by apply
  const recovered = await auditMod.recoverFieldCorrectionLogFromAudit(db, PAGE1);
  assert.ok(recovered.length >= 1);
  assert.equal(recovered[0].newValue, TARGET_PO);
  const healedHeader = reconcileMod.applyFieldCorrectionLogToHeader(
    parserBlank,
    recovered,
  );
  assert.equal(healedHeader.customerPoOrReference, TARGET_PO);
  ok("audit recovery restores wiped fieldCorrectionLog");

  // 8) page-2 isolation
  const page2After = db._store.get(`vendorInvoiceImports/${PAGE2}`);
  assert.deepEqual(
    page2After.parsedHeader,
    page2Before.parsedHeader,
    "page-1 chat/apply must not mutate page-2 header",
  );
  assert.deepEqual(
    page2After.fieldCorrectionLog,
    page2Before.fieldCorrectionLog,
  );
  // Shared evidence readable by both
  const page2Windows = context.extractTextWindows(
    EXTRACTED,
    "what PO do you see",
    context.seedTermsFromAuthoritativeState({
      parsedHeader: page2After.parsedHeader,
      fieldCorrectionLog: page2After.fieldCorrectionLog,
    }),
  );
  assert.ok(page2Windows.some((w) => /2205\s+EARLY|truck stock/i.test(w.text)));
  // F — page-2 eligibility independent of page-1 apply activity
  const page2Elig = reconcileMod.reconcileImportStateAfterCorrection({
    parsedHeader: {
      ...page2After.parsedHeader,
      orderDate: "2026-01-01",
      customerAccountNumber: "12345",
      vendorBranchName: "Johnstone Supply",
      buyerName: "Acme HVAC",
    },
    parseWarnings: page2After.parseWarnings,
    importStatus: "pickup_at_vendor",
    confidenceScore: page2After.confidenceScore,
    humanReviewRequired: page2After.humanReviewRequired,
    duplicate: false,
    parserFormatId: "johnstone",
    parsedLines: [
      {
        lineType: "product",
        excludeFromExpectedItems: false,
        quantityOrdered: 1,
        quantityShipped: 1,
        quantityBackordered: 0,
      },
    ],
    parsedLineCount: 1,
    fieldCorrectionLog: page2After.fieldCorrectionLog,
  });
  assert.equal(page2Elig.importDecisionMode, "suggested_import");
  assert.notEqual(
    page2After.parsedHeader.vendorInvoiceNumber,
    afterApply.parsedHeader.vendorInvoiceNumber,
  );
  ok("page-1/page-2 isolation; shared batch text is read-only evidence");

  // 9) Idempotent re-apply
  db._store.set(`vendorInvoiceImports/${PAGE1}`, structuredClone(afterApply));
  const applyAgain = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: PAGE1,
    sourceMessageId: proposalMessageId,
    idempotencyKey: "truth-k1-again",
    triggerMode: "apply_button",
  });
  assert.equal(applyAgain.alreadyApplied || applyAgain.applied === false, true);
  assert.equal(
    db._store.get(`vendorInvoiceImports/${PAGE1}`).parsedHeader
      .customerPoOrReference,
    TARGET_PO,
  );
  ok("repeated apply remains idempotent");

  // 10) Unsupported ZZZX still unsupported via parse path
  const unsupported = promptMod.parseAndValidateReviewAgentResponse(
    {
      actionType: "answer",
      answerText:
        "ZZZX-PO-DOES-NOT-EXIST-99999 is not present in the provided evidence.",
      citations: [
        {
          sourceType: "dispatcher_assertion",
          text: "ZZZX-PO-DOES-NOT-EXIST-99999",
        },
      ],
    },
    EXTRACTED,
    {
      dispatcherMessage:
        "I see the PO and it is ZZZX-PO-DOES-NOT-EXIST-99999. Check the invoice again.",
      parserCustomerPo: TARGET_PO,
      parsedHeader: { customerPoOrReference: TARGET_PO },
      fieldCorrectionLog: afterApply.fieldCorrectionLog,
    },
  );
  assert.ok(!("ok" in unsupported && unsupported.ok === false));
  assert.match(unsupported.answerText, /2205 EARLY|Current authoritative/i);
  ok("unsupported ZZZX path does not erase current authoritative PO");

}

console.log("\nAll invoice review truth-state tests passed.");
