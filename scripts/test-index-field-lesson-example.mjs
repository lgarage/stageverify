/**
 * Lane C C3-C.1 — unit tests for field lesson example indexing (no parse effect).
 * Usage: npm run test:index-field-lesson-example
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib", "invoice", "reviewChat");
const srcRoot = path.join(__dirname, "..", "functions", "src");

const indexMod = await import(
  pathToFileURL(path.join(libRoot, "indexFieldLessonExample.js")).href
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
      async create(data) {
        if (store.has(fullPath)) {
          const err = new Error("ALREADY_EXISTS");
          err.code = 6;
          throw err;
        }
        store.set(fullPath, structuredClone(data));
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

function assertExpireAtNear365d(expireAt, verifiedAtIso) {
  let ms;
  if (expireAt && typeof expireAt.toMillis === "function") {
    ms = expireAt.toMillis();
  } else if (expireAt && typeof expireAt._seconds === "number") {
    ms = expireAt._seconds * 1000;
  } else if (expireAt && typeof expireAt.seconds === "number") {
    ms = expireAt.seconds * 1000;
  } else {
    assert.fail(`expireAt missing Timestamp shape: ${JSON.stringify(expireAt)}`);
  }
  const verifiedMs = Date.parse(verifiedAtIso);
  assert.ok(Math.abs(ms - (verifiedMs + 365 * 86400000)) < 2000);
}

function seedApply(opts = {}) {
  const importId = opts.importId ?? "imp-c3c-1";
  const messageId = opts.messageId ?? "msg-propose-c3c-1";
  const inboundId = opts.inboundId ?? "inbound-c3c-1";
  const field = opts.field ?? "customerPoOrReference";
  const currentValue = opts.currentValue ?? "";
  const proposedValue = opts.proposedValue ?? "2205 EARLY";
  const seed = {
    [`vendorInvoiceImports/${importId}`]: {
      reviewStatus: "pending_review",
      importStatus: "pending",
      confidenceScore: opts.confidenceScore ?? 80,
      humanReviewRequired: true,
      duplicate: false,
      parserFormatId: opts.parserFormatId ?? "johnstone",
      detectedVendorName: opts.detectedVendorName ?? "Johnstone Supply",
      pageId: "p1",
      parsedHeader: {
        vendorInvoiceNumber: "6168733",
        vendorOrderNumber: "SO9",
        customerPoOrReference: currentValue,
        orderDate: "2026-01-01",
        customerAccountNumber: "12345",
        vendorBranchName: "Johnstone Supply",
        buyerName: "Acme HVAC",
      },
      parsedLines: [
        {
          lineType: "product",
          excludeFromExpectedItems: false,
          quantityOrdered: 2,
          quantityShipped: 2,
          quantityBackordered: 0,
        },
      ],
      parsedLineCount: 1,
      parseWarnings: ["missing customerPoOrReference"],
      reviewRequiredReasons: ["Missing Customer P/O"],
      importDecisionMode: "review_required",
      autoImportEligible: false,
      suggestedAction: "Review required",
      inboundEmailProcessingId: inboundId,
      approvalState: "pending",
      linkedDeliveryOrderId: null,
      stagingLocationIds: ["Z1"],
    },
    [`inboundEmailProcessing/${inboundId}`]: {
      combinedExtractedText: opts.extracted ?? EXTRACTED,
      senderEmail: opts.senderEmail ?? "orders@johnstone.com",
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
  return { db: createMemoryDb(seed), importId, messageId };
}

function listExamples(db) {
  const prefix = "vendorInvoiceFieldLessonExamples/";
  return [...db._store.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ id: k.slice(prefix.length), ...v }));
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// --- Pure builder ---
{
  const built = indexMod.buildFieldLessonExampleFromApply({
    correctionId: "imp-1__customerPoOrReference__msg-1",
    vendorInvoiceImportId: "imp-1",
    sourceChatMessageId: "msg-1",
    field: "customerPoOrReference",
    originalValue: "",
    correctedValue: "2205 EARLY",
    evidenceType: "document_evidence",
    actorUid: "u1",
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    senderDomain: "johnstone.com",
    verifiedAt: "2026-08-09T12:00:00.000Z",
  });
  assert.equal(built.ok, true);
  assert.equal(built.doc.sourceDocumentKey, "imp-1");
  assert.equal(built.doc.vendorInvoiceImportId, "imp-1");
  assert.equal(built.doc.exampleId, "imp-1__customerPoOrReference__msg-1");
  assert.equal(built.doc.retentionDays, 365);
  assert.equal(built.doc.status, "active");
  assert.equal(
    built.doc.scopeKey,
    "johnstone-supply__johnstone__johnstone.com__customerPoOrReference",
  );
  assert.ok(built.doc.expireAt);
  assert.equal(typeof built.doc.expireAt.toMillis, "function");
  const ms = built.doc.expireAt.toMillis();
  const verifiedMs = Date.parse("2026-08-09T12:00:00.000Z");
  assert.ok(Math.abs(ms - (verifiedMs + 365 * 86400000)) < 1000);
  ok("builder: happy path + sourceDocumentKey + Timestamp expireAt +365d");
}

{
  const skipVendor = indexMod.buildFieldLessonExampleFromApply({
    correctionId: "c1",
    vendorInvoiceImportId: "imp-1",
    sourceChatMessageId: "m1",
    field: "customerPoOrReference",
    originalValue: "",
    correctedValue: "X",
    evidenceType: "document_evidence",
    actorUid: "u1",
    detectedVendorName: "",
    parserFormatId: "johnstone",
    senderDomain: "johnstone.com",
  });
  assert.equal(skipVendor.ok, false);
  assert.equal(skipVendor.reason, "vendor_not_armable");

  // Must NOT invent johnstone from parserFormatId alone
  const skipFallback = indexMod.buildFieldLessonExampleFromApply({
    correctionId: "c1",
    vendorInvoiceImportId: "imp-1",
    sourceChatMessageId: "m1",
    field: "customerPoOrReference",
    originalValue: "",
    correctedValue: "X",
    evidenceType: "document_evidence",
    actorUid: "u1",
    detectedVendorName: undefined,
    parserFormatId: "johnstone",
    senderDomain: "johnstone.com",
  });
  assert.equal(skipFallback.ok, false);
  assert.equal(skipFallback.reason, "vendor_not_armable");
  ok("builder: vendor fail-closed (no johnstone-from-format)");
}

{
  const skipFmt = indexMod.buildFieldLessonExampleFromApply({
    correctionId: "c1",
    vendorInvoiceImportId: "imp-1",
    sourceChatMessageId: "m1",
    field: "customerPoOrReference",
    originalValue: "",
    correctedValue: "X",
    evidenceType: "document_evidence",
    actorUid: "u1",
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "unknown",
    senderDomain: "johnstone.com",
  });
  assert.equal(skipFmt.ok, false);
  assert.equal(skipFmt.reason, "format_unknown");
  ok("builder: unknown parserFormatId skip");
}

{
  const skipSender = indexMod.buildFieldLessonExampleFromApply({
    correctionId: "c1",
    vendorInvoiceImportId: "imp-1",
    sourceChatMessageId: "m1",
    field: "customerPoOrReference",
    originalValue: "",
    correctedValue: "X",
    evidenceType: "document_evidence",
    actorUid: "u1",
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    senderDomain: "",
  });
  assert.equal(skipSender.ok, false);
  assert.equal(skipSender.reason, "sender_domain_unavailable");
  ok("builder: missing sender domain skip");
}

// --- Write path via apply ---
{
  const { db, importId, messageId } = seedApply();
  const beforeHeader = structuredClone(
    db._store.get(`vendorInvoiceImports/${importId}`).parsedHeader,
  );
  const beforeConfidence = db._store.get(
    `vendorInvoiceImports/${importId}`,
  ).confidenceScore;

  const r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r.applied, true);
  // Allow microtask/promise for void index
  await new Promise((r) => setTimeout(r, 20));

  const examples = listExamples(db);
  assert.equal(examples.length, 1);
  assert.equal(examples[0].sourceDocumentKey, importId);
  assert.equal(examples[0].evidenceType, "document_evidence");
  assert.equal(examples[0].correctedValue, "2205 EARLY");
  assert.equal(examples[0].retentionDays, 365);
  assert.ok(examples[0].expireAt);
  assertExpireAtNear365d(examples[0].expireAt, examples[0].verifiedAt);

  // No-parse-effect: header/confidence from apply path only (C2), example inert
  assert.equal(
    db._store.get(`vendorInvoiceImports/${importId}`).confidenceScore,
    beforeConfidence,
  );
  assert.equal(
    db._store.get(`vendorInvoiceImports/${importId}`).parsedHeader
      .customerPoOrReference,
    "2205 EARLY",
  );
  assert.notDeepEqual(
    db._store.get(`vendorInvoiceImports/${importId}`).parsedHeader,
    beforeHeader,
  );
  ok("apply→example indexed with sourceDocumentKey; confidence unchanged");
}

// Same document, three correction events → three examples, one sourceDocumentKey
{
  const importId = "imp-multi-corr";
  const values = ["ALPHA1", "BRAVO2", "CHARLIE3"];
  const inboundId = "inbound-multi";
  const { db } = seedApply({
    importId,
    inboundId,
    messageId: "msg-0",
    proposedValue: values[0],
    currentValue: "",
    extracted: `${EXTRACTED}\n${values.join("\n")}`,
  });
  let r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: "msg-0",
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r.applied, true);
  await new Promise((x) => setTimeout(x, 20));

  for (let i = 1; i < values.length; i += 1) {
    const msgId = `msg-${i}`;
    const prev = values[i - 1];
    const next = values[i];
    db._store.set(`vendorInvoiceImportChats/${importId}/messages/${msgId}`, {
      role: "agent",
      text: `Propose ${next}`,
      createdAt: `2026-08-09T00:00:0${i}.000Z`,
      createdByUid: "system",
      proposedCorrection: {
        field: "customerPoOrReference",
        currentValue: prev,
        proposedValue: next,
        sourceType: "document_evidence",
      },
      correctionStatus: "proposed",
    });
    r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
      db,
      uid: "u1",
      vendorInvoiceImportId: importId,
      sourceMessageId: msgId,
      idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
    });
    assert.equal(r.applied, true, `apply ${i} should succeed: ${r.applied}`);
    await new Promise((x) => setTimeout(x, 20));
  }

  const examples = listExamples(db).filter(
    (e) => e.sourceDocumentKey === importId,
  );
  assert.equal(examples.length, 3);
  const distinctDocs = new Set(examples.map((e) => e.sourceDocumentKey));
  assert.equal(distinctDocs.size, 1);
  ok(
    "3 corrections on one import → 3 example docs, 1 distinct sourceDocumentKey (no threshold inflation)",
  );
}

// alreadyMatched → no example
{
  const { db, importId, messageId } = seedApply({
    currentValue: "2205 EARLY",
    proposedValue: "2205 EARLY",
  });
  const r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r.applied, false);
  assert.equal(r.alreadyApplied, true);
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(listExamples(db).length, 0);
  ok("alreadyMatched path → no example indexed");
}

// Idempotent create
{
  const { db, importId, messageId } = seedApply({
    importId: "imp-idem",
    messageId: "msg-idem",
  });
  const r1 = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r1.applied, true);
  await new Promise((x) => setTimeout(x, 20));
  const first = listExamples(db)[0];
  const r2 = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r2.alreadyApplied, true);
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(listExamples(db).length, 1);
  assert.deepEqual(listExamples(db)[0].correctedValue, first.correctedValue);
  ok("retry/alreadyApplied → no duplicate example; first doc unchanged");
}

// Index write failure must not fail C2
{
  const { db, importId, messageId } = seedApply({
    importId: "imp-fail-index",
    messageId: "msg-fail-index",
  });
  const origCollection = db.collection.bind(db);
  db.collection = (name) => {
    const col = origCollection(name);
    if (name !== "vendorInvoiceFieldLessonExamples") return col;
    return {
      ...col,
      doc(id) {
        const ref = col.doc(id);
        return {
          ...ref,
          async create() {
            throw new Error("simulated index failure");
          },
        };
      },
    };
  };
  const r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r.applied, true);
  await new Promise((x) => setTimeout(x, 150));
  assert.equal(
    db._store.get(`vendorInvoiceImports/${importId}`).parsedHeader
      .customerPoOrReference,
    "2205 EARLY",
  );
  ok("index throw → C2 still applied:true; CURRENT corrected");
}

// Unknown vendor / missing sender → C2 ok, no example
{
  const { db, importId, messageId } = seedApply({
    importId: "imp-skip-vendor",
    messageId: "msg-skip-vendor",
    detectedVendorName: "",
  });
  // Remove vendor name entirely
  delete db._store.get(`vendorInvoiceImports/${importId}`).detectedVendorName;
  const r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r.applied, true);
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(listExamples(db).length, 0);
  ok("missing detectedVendorName → C2 success, no example");
}

{
  const { db, importId, messageId } = seedApply({
    importId: "imp-skip-sender",
    messageId: "msg-skip-sender",
    senderEmail: "",
  });
  const r = await applyMod.runApplyInvoiceReviewFieldCorrectionCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: importId,
    sourceMessageId: messageId,
    idempotencyKey: "k-c3c",
    triggerMode: "apply_button",
  });
  assert.equal(r.applied, true);
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(listExamples(db).length, 0);
  ok("missing senderEmail → C2 success, no example");
}

// --- No-parse-effect import boundary (grep) ---
{
  const bannedDirs = [
    path.join(srcRoot, "invoice", "parseJohnstoneInvoice.ts"),
    path.join(srcRoot, "invoice", "parseFirstSupplyInvoice.ts"),
    path.join(srcRoot, "invoice", "processInvoiceForInbound.ts"),
    path.join(srcRoot, "invoice", "computeAutoImportEligibility.ts"),
    path.join(srcRoot, "invoice", "vendorInvoiceRouter.ts"),
    path.join(srcRoot, "inboundEmail"),
  ];
  const needle = "vendorInvoiceFieldLessonExamples";
  const needle2 = "indexFieldLessonExample";
  const offenders = [];
  function walk(p) {
    const st = readdirSync(p, { withFileTypes: true });
    for (const ent of st) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".ts") || ent.name.endsWith(".js")) {
        const text = readFileSync(full, "utf8");
        if (text.includes(needle) || text.includes(needle2)) {
          // allow only reviewChat index + apply wire + this test's compiled path
          if (
            full.includes(`${path.sep}reviewChat${path.sep}indexFieldLessonExample`) ||
            full.includes(`${path.sep}reviewChat${path.sep}applyInvoiceReviewFieldCorrection`)
          ) {
            continue;
          }
          offenders.push(full);
        }
      }
    }
  }
  for (const p of bannedDirs) {
    try {
      const st = readdirSync(p, { withFileTypes: true });
      if (st) {
        /* file or dir */
      }
    } catch {
      // single file
    }
    try {
      const text = readFileSync(p, "utf8");
      if (text.includes(needle) || text.includes(needle2)) offenders.push(p);
    } catch {
      walk(p);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `parse/inbound/eligibility must not import examples: ${offenders.join(", ")}`,
  );
  ok("no-parse-effect: parser/reparse/inbound/eligibility do not reference examples store");
}

console.log(`PASS: test-index-field-lesson-example (${passed} checks)`);
