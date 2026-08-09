/**
 * Lane C C2 — natural confirmation proof ("Yes, apply it.").
 * Verifies propose → confirm → applyInvoiceReviewFieldCorrection path
 * with original sourceMessageId linkage, idempotency, and ambiguity safety.
 *
 * Usage: npm run test:c2-natural-confirmation
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(
  __dirname,
  "..",
  "functions",
  "lib",
  "invoice",
  "reviewChat",
);

const classifier = await import(
  pathToFileURL(path.join(libRoot, "correctionIntentClassifier.js")).href
);
const applyMod = await import(
  pathToFileURL(path.join(libRoot, "applyInvoiceReviewFieldCorrection.js")).href
);
const turnMod = await import(
  pathToFileURL(path.join(libRoot, "runReviewAgentTurn.js")).href
);

const EXTRACTED = `
JOHNSTONE SUPPLY
INVOICE 6168733
CUSTOMER P/O
2205 EARLY
SHIP VIA: OUR TRUCK
`.trim();

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
          store.set(fullPath, {
            ...store.get(fullPath),
            ...structuredClone(data),
          });
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
    return {
      doc(id) {
        const docId =
          id ?? `auto_${Math.random().toString(36).slice(2)}_${store.size}`;
        return makeDocRef(pathOf(basePath, docId));
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
        return { docs };
      },
    };
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

function seedBase(importId) {
  return {
    [`vendorInvoiceImports/${importId}`]: {
      reviewStatus: "pending_review",
      parsedHeader: {
        vendorInvoiceNumber: "6168733",
        vendorOrderNumber: "SO9",
        customerPoOrReference: "",
        orderDate: "2026-01-01",
      },
      inboundEmailProcessingId: "inbound-nc-1",
      approvalState: "pending",
      linkedDeliveryOrderId: null,
      stagingLocationIds: ["Z1"],
    },
    [`inboundEmailProcessing/inbound-nc-1`]: {
      combinedExtractedText: EXTRACTED,
    },
    [`vendorInvoiceImportChats/${importId}`]: {
      vendorInvoiceImportId: importId,
      turnCount: 0,
    },
    [`deliveries/del-nc`]: { status: "pending", po: "OLD" },
    [`vendorTrainingPlaybook/v1`]: { lessons: ["x"] },
    [`vendorInvoiceIgnoreRules/r1`]: { enabled: true },
  };
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// Classifier: natural confirm
{
  const intent = classifier.classifyCorrectionIntent("Yes, apply it.");
  assert.equal(intent.kind, "confirmation");
  ok('classifier: "Yes, apply it." → confirmation');
}

// --- Full propose → natural confirm → apply path ---
{
  const importId = "imp-natural-1";
  const db = createMemoryDb(seedBase(importId));
  const beforeDel = structuredClone(db._store.get("deliveries/del-nc"));
  const beforePlay = structuredClone(
    db._store.get("vendorTrainingPlaybook/v1"),
  );
  const beforeIgn = structuredClone(
    db._store.get("vendorInvoiceIgnoreRules/r1"),
  );

  // 1) Propose turn (dispatcher asks to capture PO — no apply yet)
  const proposeGen = async () => ({
    actionType: "suggest_correction_may_be_needed",
    answerText:
      "I found “2205 EARLY” in the Customer P/O field. The current parsed value is blank. I can update Customer PO to 2205 EARLY.",
    citations: [
      { sourceType: "document_evidence", text: "2205 EARLY" },
      {
        sourceType: "parser_value",
        text: "(empty)",
        field: "parsedHeader.customerPoOrReference",
      },
    ],
    proposedCorrection: {
      field: "customerPoOrReference",
      currentValue: "",
      proposedValue: "2205 EARLY",
    },
  });

  const proposeTurn = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    message: "I see the PO is 2205 EARLY. Check the invoice again.",
    generateJson: proposeGen,
  });

  assert.ok(proposeTurn.agentMessage.proposedCorrection);
  assert.equal(
    proposeTurn.agentMessage.proposedCorrection.field,
    "customerPoOrReference",
  );
  assert.equal(
    proposeTurn.agentMessage.proposedCorrection.proposedValue,
    "2205 EARLY",
  );
  assert.equal(proposeTurn.agentMessage.correctionStatus, "proposed");
  assert.notEqual(proposeTurn.autoApplyEligible, true);
  const proposalMessageId = proposeTurn.messageId;
  ok("propose creates pending correction; no auto-apply");

  // Import still blank before confirm
  const midImp = db._store.get(`vendorInvoiceImports/${importId}`);
  assert.equal(midImp.parsedHeader.customerPoOrReference, "");
  assert.equal(midImp.reviewStatus, "pending_review");

  // 2) Natural confirmation — model may even echo a proposedCorrection;
  //    auto-apply must still target ORIGINAL proposal message id.
  const confirmGen = async () => ({
    actionType: "answer",
    answerText: "Confirming — applying the pending Customer PO correction.",
    citations: [
      { sourceType: "dispatcher_assertion", text: "Yes, apply it." },
    ],
    // Hostile/extra proposal on confirm turn — must NOT become the apply target.
    proposedCorrection: {
      field: "customerPoOrReference",
      currentValue: "",
      proposedValue: "EVIL-NEW-PO",
    },
  });

  const confirmTurn = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    message: "Yes, apply it.",
    generateJson: confirmGen,
  });

  assert.equal(confirmTurn.autoApplyEligible, true);
  assert.equal(confirmTurn.autoApplyTriggerMode, "chat_confirmation");
  assert.equal(
    confirmTurn.autoApplyMessageId,
    proposalMessageId,
    "must resolve to original pending proposal message",
  );
  assert.notEqual(
    confirmTurn.autoApplyMessageId,
    confirmTurn.messageId,
    "must not create/target a new arbitrary correction message",
  );
  ok("natural confirm resolves to original sourceMessageId (not new proposal)");

  // 3) Same protected apply path with chat_confirmation trigger
  const applyResult = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    sourceMessageId: confirmTurn.autoApplyMessageId,
    idempotencyKey: "nc-k1",
    triggerMode: "chat_confirmation",
  });

  assert.equal(applyResult.applied, true);
  assert.equal(applyResult.field, "customerPoOrReference");
  assert.equal(applyResult.newValue, "2205 EARLY");
  assert.equal(applyResult.previousValue, "");
  assert.equal(applyResult.parsedHeader.customerPoOrReference, "2205 EARLY");
  assert.equal(applyResult.reviewStatus, "pending_review");
  assert.equal(
    applyResult.correctionId,
    `${importId}__customerPoOrReference__${proposalMessageId}`,
  );

  const afterImp = db._store.get(`vendorInvoiceImports/${importId}`);
  assert.equal(afterImp.parsedHeader.customerPoOrReference, "2205 EARLY");
  assert.equal(afterImp.reviewStatus, "pending_review");
  assert.deepEqual(afterImp.stagingLocationIds, ["Z1"]);
  assert.equal(afterImp.linkedDeliveryOrderId, null);
  assert.deepEqual(db._store.get("deliveries/del-nc"), beforeDel);
  assert.deepEqual(db._store.get("vendorTrainingPlaybook/v1"), beforePlay);
  assert.deepEqual(db._store.get("vendorInvoiceIgnoreRules/r1"), beforeIgn);

  const audits = [...db._store.keys()].filter((k) =>
    k.startsWith("vendorInvoiceFieldCorrections/"),
  );
  assert.equal(audits.length, 1);
  const audit = db._store.get(audits[0]);
  assert.equal(audit.sourceChatMessageId, proposalMessageId);
  assert.equal(audit.triggerMode, "chat_confirmation");
  assert.equal(audit.correctionSourceType, "document_evidence");
  assert.equal(audit.newValue, "2205 EARLY");

  // Durable applied chat event exists
  const msgDocs = [...db._store.entries()].filter(([k]) =>
    k.startsWith(`vendorInvoiceImportChats/${importId}/messages/`),
  );
  const appliedMsg = msgDocs.find(([, v]) =>
    String(v.text ?? "").startsWith("Applied."),
  );
  assert.ok(appliedMsg, "durable Applied chat message present");
  const proposalMsg = db._store.get(
    `vendorInvoiceImportChats/${importId}/messages/${proposalMessageId}`,
  );
  assert.equal(proposalMsg.correctionStatus, "applied");

  ok("apply path updates parsedHeader; one audit; Applied chat; no approve/delivery/knowledge");

  // 4) Idempotency — confirm/apply again
  const confirmAgain = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    message: "Yes, apply it.",
    generateJson: async () => ({
      actionType: "answer",
      answerText: "Nothing pending to apply.",
      citations: [],
    }),
  });
  // After apply, proposal is applied — no pending → no auto-apply
  assert.notEqual(confirmAgain.autoApplyEligible, true);

  // Explicit re-apply of same sourceMessageId is idempotent
  const applyAgain = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    sourceMessageId: proposalMessageId,
    idempotencyKey: "nc-k2",
    triggerMode: "chat_confirmation",
  });
  assert.equal(applyAgain.alreadyApplied, true);
  assert.equal(applyAgain.applied, false);
  assert.equal(applyAgain.newValue, "2205 EARLY");
  const audits2 = [...db._store.keys()].filter((k) =>
    k.startsWith("vendorInvoiceFieldCorrections/"),
  );
  assert.equal(audits2.length, 1, "no duplicate audit");
  const imp2 = db._store.get(`vendorInvoiceImports/${importId}`);
  assert.equal(imp2.parsedHeader.customerPoOrReference, "2205 EARLY");
  ok("repeated Yes, apply it. / re-apply is idempotent (no second mutation/audit)");

  // Transcript artifact
  const outDir = path.join(
    __dirname,
    "..",
    "screenshots",
    "invoice-review-chat",
  );
  mkdirSync(outDir, { recursive: true });
  const transcript = {
    scenario: "C2 natural confirmation → apply",
    turns: [
      {
        role: "dispatcher",
        text: "I see the PO is 2205 EARLY. Check the invoice again.",
      },
      {
        role: "agent",
        text: proposeTurn.agentMessage.text,
        proposedCorrection: proposeTurn.agentMessage.proposedCorrection,
        messageId: proposalMessageId,
      },
      { role: "dispatcher", text: "Yes, apply it." },
      {
        role: "system",
        autoApplyEligible: true,
        autoApplyMessageId: confirmTurn.autoApplyMessageId,
        autoApplyTriggerMode: "chat_confirmation",
        serverPath: "applyInvoiceReviewFieldCorrection",
      },
      {
        role: "result",
        parsedHeaderCustomerPo:
          applyResult.parsedHeader.customerPoOrReference,
        auditCount: 1,
        reviewStatus: applyResult.reviewStatus,
        correctionId: applyResult.correctionId,
      },
    ],
  };
  const transcriptPath = path.join(outDir, "c2-natural-confirmation-transcript.json");
  writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
  console.log("Wrote", transcriptPath);
}

// --- Ambiguity safety: two pending proposals → vague Yes must NOT apply ---
{
  const importId = "imp-ambiguous";
  const db = createMemoryDb({
    ...seedBase(importId),
    [`vendorInvoiceImportChats/${importId}/messages/p1`]: {
      role: "agent",
      text: "Propose PO",
      createdAt: "2026-08-09T00:00:01.000Z",
      createdByUid: "system",
      proposedCorrection: {
        field: "customerPoOrReference",
        currentValue: "",
        proposedValue: "2205 EARLY",
        sourceType: "document_evidence",
      },
      correctionStatus: "proposed",
    },
    [`vendorInvoiceImportChats/${importId}/messages/p2`]: {
      role: "agent",
      text: "Propose order #",
      createdAt: "2026-08-09T00:00:02.000Z",
      createdByUid: "system",
      proposedCorrection: {
        field: "vendorOrderNumber",
        currentValue: "SO9",
        proposedValue: "SO99",
        sourceType: "document_evidence",
      },
      correctionStatus: "proposed",
    },
  });

  const turn = await turnMod.runReviewAgentTurnCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    message: "Yes, apply it.",
    generateJson: async () => ({
      actionType: "answer",
      answerText:
        "There are multiple pending corrections — please click Apply on the one you want, or name the field.",
      citations: [],
      // Even if model tries to propose again, vague yes must not auto-apply
      proposedCorrection: {
        field: "customerPoOrReference",
        currentValue: "",
        proposedValue: "2205 EARLY",
      },
    }),
  });

  assert.notEqual(
    turn.autoApplyEligible,
    true,
    "ambiguous pending proposals must not auto-apply",
  );
  assert.equal(turn.autoApplyMessageId, undefined);
  const imp = db._store.get(`vendorInvoiceImports/${importId}`);
  assert.equal(imp.parsedHeader.customerPoOrReference, "");
  assert.equal(imp.parsedHeader.vendorOrderNumber, "SO9");
  const audits = [...db._store.keys()].filter((k) =>
    k.startsWith("vendorInvoiceFieldCorrections/"),
  );
  assert.equal(audits.length, 0);
  ok("ambiguity: two pending proposals → Yes, apply it. does not guess/apply");
}

console.log(`PASS: test-c2-natural-confirmation (${passed} checks)`);
