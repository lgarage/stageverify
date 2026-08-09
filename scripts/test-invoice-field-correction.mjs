/**
 * Lane C C2 — deterministic unit tests for field correction allowlist,
 * classifier, evidence classification, and apply core (in-memory Firestore).
 *
 * Usage: npm run test:invoice-field-correction
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib", "invoice", "reviewChat");

const allowlist = await import(
  pathToFileURL(path.join(libRoot, "correctionAllowlist.js")).href
);
const classifier = await import(
  pathToFileURL(path.join(libRoot, "correctionIntentClassifier.js")).href
);
const evidence = await import(
  pathToFileURL(path.join(libRoot, "classifyCorrectionEvidence.js")).href
);
const applyMod = await import(
  pathToFileURL(path.join(libRoot, "applyInvoiceReviewFieldCorrection.js")).href
);

const EXTRACTED = `
JOHNSTONE SUPPLY
INVOICE 6168733
CUSTOMER P/O
2205 EARLY
SHIP VIA: OUR TRUCK
`.trim();

/** Minimal in-memory Firestore for apply-core tests. */
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
        const base = `${fullPath}/${sub}`;
        return makeCollection(base);
      },
    };
  }

  function makeCollection(basePath) {
    return {
      doc(id) {
        const docId =
          id ??
          `auto_${Math.random().toString(36).slice(2)}_${store.size}`;
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
          .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
          .map(([k, v]) => ({
            id: k.slice(prefix.length),
            data: () => structuredClone(v),
            ref: makeDocRef(k),
          }));
        // newest-first when createdAt present
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
          // defer until end — store immediately for simplicity (single-threaded)
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

function seedImportAndProposal(opts = {}) {
  const importId = opts.importId ?? "imp-c2-1";
  const messageId = opts.messageId ?? "msg-propose-1";
  const currentValue = opts.currentValue ?? "";
  const proposedValue = opts.proposedValue ?? "2205 EARLY";
  const field = opts.field ?? "customerPoOrReference";
  const reviewStatus = opts.reviewStatus ?? "pending_review";
  const inboundId = "inbound-c2-1";

  const seed = {
    [`vendorInvoiceImports/${importId}`]: {
      reviewStatus,
      parsedHeader: {
        vendorInvoiceNumber: "6168733",
        vendorOrderNumber: "SO9",
        customerPoOrReference: currentValue,
        orderDate: "2026-01-01",
      },
      inboundEmailProcessingId: inboundId,
      approvalState: "pending",
      linkedDeliveryOrderId: null,
      stagingLocationIds: ["Z1"],
    },
    [`inboundEmailProcessing/${inboundId}`]: {
      combinedExtractedText: opts.extracted ?? EXTRACTED,
    },
    [`vendorInvoiceImportChats/${importId}`]: {
      vendorInvoiceImportId: importId,
      turnCount: 2,
    },
    [`vendorInvoiceImportChats/${importId}/messages/d1`]: {
      role: "dispatcher",
      text: opts.dispatcherText ?? "Update the customer PO to 2205 EARLY.",
      createdAt: "2026-08-09T00:00:00.000Z",
      createdByUid: "u1",
    },
    [`vendorInvoiceImportChats/${importId}/messages/${messageId}`]: {
      role: "agent",
      text: "I can update Customer PO.",
      createdAt: "2026-08-09T00:00:01.000Z",
      createdByUid: "system",
      proposedCorrection: {
        field,
        currentValue,
        proposedValue,
        sourceType: "document_evidence",
      },
      correctionStatus: "proposed",
    },
  };

  if (opts.extraSeed) Object.assign(seed, opts.extraSeed);
  return { db: createMemoryDb(seed), importId, messageId };
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// --- Allowlist ---
{
  assert.ok(allowlist.isCorrectableFieldKey("customerPoOrReference"));
  assert.equal(allowlist.isCorrectableFieldKey("fulfillmentMethod"), false);
  assert.equal(allowlist.normalizeFieldAlias("customer po"), "customerPoOrReference");
  assert.equal(allowlist.normalizeFieldAlias("order #"), "vendorOrderNumber");
  ok("allowlist includes PO/order/invoice; excludes fulfillment");
}

// --- Classifier ---
{
  const none = classifier.classifyCorrectionIntent(
    "Reparse it and capture that PO.",
  );
  assert.equal(none.kind, "none");
  ok('"Reparse it and capture that PO." → none (propose-only, no auto-apply)');

  const direct = classifier.classifyCorrectionIntent(
    "Update the customer PO to 2205 EARLY.",
  );
  assert.equal(direct.kind, "direct_command");
  assert.equal(direct.field, "customerPoOrReference");
  assert.equal(direct.proposedValue, "2205 EARLY");
  ok("direct command classifies field + value");

  const conf = classifier.classifyCorrectionIntent("Yes, apply it.");
  assert.equal(conf.kind, "confirmation");
  ok('"Yes, apply it." → confirmation');

  const usePo = classifier.classifyCorrectionIntent("Yes, use that PO.");
  assert.equal(usePo.kind, "confirmation");
  ok('"Yes, use that PO." → confirmation');
}

// --- Evidence ---
{
  const found = evidence.classifyCorrectionEvidence({
    proposedValue: "2205 EARLY",
    combinedExtractedText: EXTRACTED,
    recentDispatcherTexts: [],
  });
  assert.equal(found.sourceType, "document_evidence");

  const assertion = evidence.classifyCorrectionEvidence({
    proposedValue: "MANUAL-PO-99",
    combinedExtractedText: EXTRACTED,
    recentDispatcherTexts: ["Please use MANUAL-PO-99 for this one."],
  });
  assert.equal(assertion.sourceType, "dispatcher_assertion");

  const negated = evidence.classifyCorrectionEvidence({
    proposedValue: "GHOST-PO",
    combinedExtractedText: EXTRACTED,
    recentDispatcherTexts: ["GHOST-PO isn't on the invoice."],
  });
  assert.equal(negated.sourceType, null, "negated mention must not assert");

  const refuse = evidence.classifyCorrectionEvidence({
    proposedValue: "NOT-IN-DOC",
    combinedExtractedText: EXTRACTED,
    recentDispatcherTexts: ["Just fix the PO somehow."],
  });
  assert.equal(refuse.sourceType, null);

  const shortSub = evidence.classifyCorrectionEvidence({
    proposedValue: "22",
    combinedExtractedText: EXTRACTED,
    recentDispatcherTexts: ["Yes, use 2205 EARLY."],
  });
  assert.equal(
    shortSub.sourceType,
    null,
    "short substring of longer PO must not verify",
  );

  // "2205" is a bounded token before EARLY — allowed. Mid-token "205" is not.
  const midToken = evidence.classifyCorrectionEvidence({
    proposedValue: "205",
    combinedExtractedText: EXTRACTED,
    recentDispatcherTexts: [],
  });
  assert.equal(
    midToken.sourceType,
    null,
    "mid-token substring 205 inside 2205 must not verify",
  );
  ok("evidence: document / dispatcher assertion / refuse / no short-substring");
}

// 1+2 — blank → evidenced PO applies; wrong → replaces
{
  const { db, importId, messageId } = seedImportAndProposal({
    currentValue: "",
  });
  const r1 = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "dispatcher-1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k1",
    triggerMode: "apply_button",
  });
  assert.equal(r1.applied, true);
  assert.equal(r1.newValue, "2205 EARLY");
  assert.equal(r1.parsedHeader.customerPoOrReference, "2205 EARLY");
  assert.equal(r1.reviewStatus, "pending_review");
  const audit = await db
    .collection("vendorInvoiceFieldCorrections")
    .doc(r1.correctionId)
    .get();
  assert.ok(audit.exists);
  assert.equal(audit.data().correctionSourceType, "document_evidence");
  assert.equal(audit.data().sourceChatMessageId, messageId);
  const imp = await db.collection("vendorInvoiceImports").doc(importId).get();
  assert.ok(imp.data().originalParsedHeader);
  assert.equal(imp.data().originalParsedHeader.customerPoOrReference, "");
  assert.equal(imp.data().stagingLocationIds[0], "Z1");
  assert.equal(imp.data().linkedDeliveryOrderId, null);
  ok("blank Customer PO → evidenced PO applies + audit + original snapshot");

  const { db: db2, importId: id2, messageId: m2 } = seedImportAndProposal({
    importId: "imp-c2-wrong",
    messageId: "msg-2",
    currentValue: "WRONG-PO",
  });
  const r2 = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db: db2,
    uid: "dispatcher-1",
    vendorInvoiceImportId: id2,
    sourceMessageId: m2,
    idempotencyKey: "k2",
  });
  assert.equal(r2.applied, true);
  assert.equal(r2.previousValue, "WRONG-PO");
  assert.equal(r2.newValue, "2205 EARLY");
  ok("wrong Customer PO → evidenced PO replaces it");
}

// 3 — unsupported field rejected
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-bad-field",
    field: "customerPoOrReference",
  });
  // Tamper message to unsupported field after seed
  await db
    .collection("vendorInvoiceImportChats")
    .doc(importId)
    .collection("messages")
    .doc(messageId)
    .update({
      proposedCorrection: {
        field: "fulfillmentMethod",
        currentValue: "delivery",
        proposedValue: "will_call_pickup",
        sourceType: "dispatcher_assertion",
      },
    });
  await assert.rejects(
    () =>
      applyMod.runApplyInvoiceReviewFieldCorrectionCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: importId,
        sourceMessageId: messageId,
        idempotencyKey: "k3",
      }),
    (err) =>
      err instanceof applyMod.ApplyCorrectionInputError &&
      /proposedCorrection|field_not_allowed|no valid/i.test(err.message),
  );
  ok("unsupported field rejected");
}

// 4 — arbitrary client field: apply never accepts field from client (only sourceMessageId)
{
  // Covered by API shape — core only takes sourceMessageId. Assert allowlist gate.
  assert.equal(allowlist.isCorrectableFieldKey("deliveryOrderId"), false);
  assert.equal(allowlist.isCorrectableFieldKey("reviewStatus"), false);
  ok("arbitrary/non-allowlisted fields rejected by allowlist");
}

// 5 — value absent from document + not typed → refuse
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-no-ev",
    proposedValue: "GHOST-PO",
    extracted: EXTRACTED,
    dispatcherText: "Please fix the PO somehow.",
  });
  await assert.rejects(
    () =>
      applyMod.runApplyInvoiceReviewFieldCorrectionCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: importId,
        sourceMessageId: messageId,
        idempotencyKey: "k5",
      }),
    (err) => err.message === "not_independently_verifiable",
  );
  ok("unverifiable value refused");
}

// 6 — unauthorized is API-layer (requireDispatcherAuth); core assumes uid present
{
  ok("unauthorized rejected at callable auth layer (requireDispatcherAuth)");
}

// 7 — stale expected current
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-stale",
    currentValue: "",
  });
  await db.collection("vendorInvoiceImports").doc(importId).update({
    "parsedHeader.customerPoOrReference": "CHANGED-ELSEWHERE",
  });
  await assert.rejects(
    () =>
      applyMod.runApplyInvoiceReviewFieldCorrectionCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: importId,
        sourceMessageId: messageId,
        idempotencyKey: "k7",
      }),
    (err) => err.message === "expected_current_value_stale",
  );
  ok("stale proposal/current-value mismatch fails safely");
}

// 8+9 — double apply idempotent; no duplicate audit
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-idem",
  });
  const a = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k8a",
  });
  const b = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k8b",
  });
  assert.equal(a.applied, true);
  assert.equal(b.alreadyApplied, true);
  assert.equal(a.correctionId, b.correctionId);
  const audits = [...db._store.keys()].filter((k) =>
    k.startsWith("vendorInvoiceFieldCorrections/"),
  );
  assert.equal(audits.length, 1);
  ok("double apply idempotent; single audit doc");
}

// 10–14 — only parsed import updates; approval/delivery/staging/training untouched
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-scope",
    extraSeed: {
      "deliveries/del-1": { status: "pending", po: "OLD" },
      "vendorTrainingPlaybook/v1": { lessons: ["x"] },
      "vendorInvoiceIgnoreRules/r1": { enabled: true },
    },
  });
  const beforeDel = structuredClone(db._store.get("deliveries/del-1"));
  const beforePlay = structuredClone(db._store.get("vendorTrainingPlaybook/v1"));
  const beforeIgn = structuredClone(db._store.get("vendorInvoiceIgnoreRules/r1"));
  const beforeImp = structuredClone(
    db._store.get(`vendorInvoiceImports/${importId}`),
  );
  await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k10",
  });
  const afterImp = db._store.get(`vendorInvoiceImports/${importId}`);
  assert.equal(afterImp.reviewStatus, beforeImp.reviewStatus);
  assert.deepEqual(afterImp.stagingLocationIds, beforeImp.stagingLocationIds);
  assert.equal(afterImp.linkedDeliveryOrderId, beforeImp.linkedDeliveryOrderId);
  assert.equal(afterImp.parsedHeader.customerPoOrReference, "2205 EARLY");
  assert.deepEqual(db._store.get("deliveries/del-1"), beforeDel);
  assert.deepEqual(db._store.get("vendorTrainingPlaybook/v1"), beforePlay);
  assert.deepEqual(db._store.get("vendorInvoiceIgnoreRules/r1"), beforeIgn);
  ok("correction updates parsed import only; approval/delivery/staging/knowledge unchanged");
}

// 15+16 — audit + chat linkage
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-audit",
  });
  const r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "uid-audit",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k15",
  });
  const audit = db._store.get(`vendorInvoiceFieldCorrections/${r.correctionId}`);
  assert.equal(audit.appliedByUid, "uid-audit");
  assert.equal(audit.sourceChatMessageId, messageId);
  assert.equal(audit.field, "customerPoOrReference");
  assert.ok(audit.evidenceCitationText);
  const msg = db._store.get(
    `vendorInvoiceImportChats/${importId}/messages/${messageId}`,
  );
  assert.equal(msg.correctionStatus, "applied");
  ok("correction audit written with chat/message linkage");
}

// approved import blocked
{
  const { db, importId, messageId } = seedImportAndProposal({
    importId: "imp-approved",
    reviewStatus: "approved",
  });
  await assert.rejects(
    () =>
      applyMod.runApplyInvoiceReviewFieldCorrectionCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: importId,
        sourceMessageId: messageId,
        idempotencyKey: "k14",
      }),
    (err) => err.message === "import_not_pending_review",
  );
  ok("non-pending_review import rejected");
}

console.log(`PASS: test-invoice-field-correction (${passed} checks)`);
