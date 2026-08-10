/**
 * Lane C C3-D.1 — evaluate propose / contradiction / threshold (memory Firestore).
 * Usage: npm run test:evaluate-field-lesson-candidate
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

function timestampFromMillis(ms) {
  return { seconds: Math.floor(ms / 1000), nanoseconds: 0 };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(
  __dirname,
  "..",
  "functions",
  "lib",
  "invoice",
  "reviewChat",
);
const evalMod = await import(
  pathToFileURL(path.join(lib, "evaluateFieldLessonCandidate.js")).href
);
const lessonsMod = await import(
  pathToFileURL(path.join(lib, "vendorInvoiceFieldLessons.js")).href
);

function createMemoryDb(seed = {}) {
  const store = new Map();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, structuredClone(v));
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
      async set(data) {
        store.set(fullPath, structuredClone(data));
      },
      async update(patch) {
        const cur = store.get(fullPath) || {};
        store.set(fullPath, { ...cur, ...structuredClone(patch) });
      },
      async create(data) {
        if (store.has(fullPath)) {
          const err = new Error("ALREADY_EXISTS");
          err.code = 6;
          throw err;
        }
        store.set(fullPath, structuredClone(data));
      },
    };
  }

  function matchesWhere(data, wheres) {
    return wheres.every(([field, op, value]) => {
      if (op === "==") return data?.[field] === value;
      return false;
    });
  }

  function makeQuery(colPath, wheres = [], order = null, lim = 1000) {
    return {
      where(field, op, value) {
        return makeQuery(colPath, [...wheres, [field, op, value]], order, lim);
      },
      orderBy(field, dir = "asc") {
        return makeQuery(colPath, wheres, { field, dir }, lim);
      },
      limit(n) {
        return makeQuery(colPath, wheres, order, n);
      },
      async get() {
        const prefix = colPath + "/";
        let rows = [...store.entries()]
          .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
          .map(([k, v]) => ({ id: k.slice(prefix.length), data: v, path: k }));
        rows = rows.filter((r) => matchesWhere(r.data, wheres));
        if (order) {
          rows.sort((a, b) => {
            const av = a.data?.[order.field];
            const bv = b.data?.[order.field];
            if (av === bv) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (av < bv) return order.dir === "desc" ? 1 : -1;
            return order.dir === "desc" ? -1 : 1;
          });
        }
        rows = rows.slice(0, lim);
        return {
          empty: rows.length === 0,
          docs: rows.map((r) => ({
            id: r.id,
            data: () => structuredClone(r.data),
            ref: makeDocRef(r.path),
          })),
        };
      },
    };
  }

  return {
    _store: store,
    collection(name) {
      return {
        doc(id) {
          return makeDocRef(`${name}/${id}`);
        },
        where(field, op, value) {
          return makeQuery(name, [[field, op, value]]);
        },
        orderBy(field, dir) {
          return makeQuery(name, [], { field, dir });
        },
        limit(n) {
          return makeQuery(name, [], null, n);
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          store.set(ref.path, structuredClone(data));
        },
        update(ref, patch) {
          const cur = store.get(ref.path) || {};
          store.set(ref.path, { ...cur, ...structuredClone(patch) });
        },
      };
      return fn(tx);
    },
  };
}

function archiveAfter(daysFromNow) {
  return timestampFromMillis(Date.now() + daysFromNow * 86400000);
}

function seedExample(db, opts) {
  const importId = opts.importId;
  const field = opts.field ?? "customerPoOrReference";
  const vendorKey = opts.vendorKey ?? "johnstone-supply";
  const senderDomain = opts.senderDomain ?? "johnstone.com";
  const parserFormatId = opts.parserFormatId ?? "johnstone";
  const scopeKey = `${vendorKey}__${parserFormatId}__${senderDomain}__${field}`;
  const correctionId = opts.correctionId ?? `${importId}__${field}__c1`;
  const extracted =
    opts.extracted ??
    `Customer P/O #\n${opts.correctedValue}\nSales Order #\nSO1\nInvoice #\nINV1\n`;
  const value = opts.correctedValue;
  const start = extracted.indexOf(value);
  assert.ok(start >= 0, "value in extracted");
  db._store.set(`vendorInvoiceImports/${importId}`, {
    inboundEmailProcessingId: `inbound-${importId}`,
    parserFormatId,
    detectedVendorName: "Johnstone Supply",
  });
  db._store.set(`inboundEmailProcessing/inbound-${importId}`, {
    combinedExtractedText: extracted,
    senderEmail: `orders@${senderDomain}`,
  });
  db._store.set(`vendorInvoiceFieldLessonExamples/${correctionId}`, {
    id: correctionId,
    exampleId: correctionId,
    correctionId,
    vendorInvoiceImportId: importId,
    sourceDocumentKey: importId,
    category: "header_field_extraction",
    field,
    vendorKey,
    parserFormatId,
    senderDomain,
    originalValue: "",
    correctedValue: value,
    evidenceType: opts.evidenceType ?? "document_evidence",
    evidenceCitationText: value,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
    actorUid: "u1",
    verifiedAt: opts.verifiedAt ?? new Date().toISOString(),
    status: "active",
    retentionDays: 365,
    archiveAfterAt: opts.archiveAfterAt ?? archiveAfter(300),
    archivedAt: null,
    scopeKey,
    source: "c2_verified_correction",
    idempotencyKey: correctionId,
  });
  return scopeKey;
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// 3 distinct docs same pattern → proposed (different correctedValues OK)
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-a",
    correctedValue: "2205 EARLY",
  });
  seedExample(db, { importId: "imp-b", correctedValue: "7842" });
  seedExample(db, { importId: "imp-c", correctedValue: "ACME-1934" });
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(r.outcome, "proposed");
  assert.equal(r.distinctDocumentCount, 3);
  assert.ok(r.lessonId);
  const lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${r.lessonId}`,
  );
  assert.equal(lesson.status, "proposed");
  assert.equal(lesson.extractionPattern.captureShapeNote, "bounded_token_near_anchor");
  assert.notEqual(lesson.status, "active");
  ok("3 docs different values → proposed (pattern consistency)");
}

// 3 events same document → 1 vote → below threshold
{
  const db = createMemoryDb();
  const importId = "imp-same";
  seedExample(db, {
    importId,
    correctionId: `${importId}__customerPoOrReference__c1`,
    correctedValue: "AAA",
    verifiedAt: "2026-08-01T00:00:00.000Z",
  });
  seedExample(db, {
    importId,
    correctionId: `${importId}__customerPoOrReference__c2`,
    correctedValue: "BBB",
    verifiedAt: "2026-08-02T00:00:00.000Z",
  });
  seedExample(db, {
    importId,
    correctionId: `${importId}__customerPoOrReference__c3`,
    correctedValue: "CCC",
    verifiedAt: "2026-08-03T00:00:00.000Z",
  });
  const scopeKey = `johnstone-supply__johnstone__johnstone.com__customerPoOrReference`;
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(r.outcome, "below_threshold");
  assert.equal(r.distinctDocumentCount, 1);
  ok("3 corrections one document → 1 vote (no inflate)");
}

// dispatcher_assertion never counts
{
  const db = createMemoryDb();
  seedExample(db, {
    importId: "imp-d1",
    correctedValue: "2205 EARLY",
    evidenceType: "dispatcher_assertion",
  });
  seedExample(db, { importId: "imp-d2", correctedValue: "7842" });
  seedExample(db, { importId: "imp-d3", correctedValue: "ACME" });
  seedExample(db, { importId: "imp-d4", correctedValue: "ZZZ" });
  const scopeKey = `johnstone-supply__johnstone__johnstone.com__customerPoOrReference`;
  // Only 3 document_evidence — assertion skipped; still 3 → propose
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(r.outcome, "proposed");
  assert.equal(r.distinctDocumentCount, 3);
  ok("dispatcher_assertion excluded from threshold");
}

// stale archiveAfterAt not counted
{
  const db = createMemoryDb();
  seedExample(db, {
    importId: "imp-old1",
    correctedValue: "A1",
    archiveAfterAt: timestampFromMillis(Date.now() - 1000),
  });
  seedExample(db, { importId: "imp-n1", correctedValue: "B1" });
  seedExample(db, { importId: "imp-n2", correctedValue: "C1" });
  seedExample(db, { importId: "imp-n3", correctedValue: "D1" });
  // 3 fresh → propose; old skipped
  const scopeKey = `johnstone-supply__johnstone__johnstone.com__customerPoOrReference`;
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(r.outcome, "proposed");
  assert.equal(r.distinctDocumentCount, 3);
  ok("stale archiveAfterAt excluded; 3 fresh propose");
}

// first_supply skipped
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-fs",
    parserFormatId: "first_supply",
    vendorKey: "first-supply",
    correctedValue: "2026-152",
    extracted: "Customer P/O #\n2026-152\n",
  });
  seedExample(db, {
    importId: "imp-fs2",
    parserFormatId: "first_supply",
    vendorKey: "first-supply",
    correctedValue: "2026-153",
    extracted: "Customer P/O #\n2026-153\n",
  });
  seedExample(db, {
    importId: "imp-fs3",
    parserFormatId: "first_supply",
    vendorKey: "first-supply",
    correctedValue: "2026-154",
    extracted: "Customer P/O #\n2026-154\n",
  });
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(r.outcome, "skipped_format");
  ok("first_supply evaluate skipped");
}

// no active status written
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-x1",
    correctedValue: "V1",
  });
  seedExample(db, { importId: "imp-x2", correctedValue: "V2" });
  seedExample(db, { importId: "imp-x3", correctedValue: "V3" });
  await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  for (const [k, v] of db._store.entries()) {
    if (k.startsWith("vendorInvoiceFieldLessons/")) {
      assert.notEqual(v.status, "active");
      assert.notEqual(v.status, "rejected");
      assert.notEqual(v.status, "archived");
    }
  }
  ok("D.1 never writes active/rejected/archived");
}

// span/value integrity — mutated extracted text at frozen offsets skips vote
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-mut1",
    correctedValue: "KEEP1",
  });
  seedExample(db, { importId: "imp-mut2", correctedValue: "KEEP2" });
  seedExample(db, { importId: "imp-mut3", correctedValue: "KEEP3" });
  // Corrupt live text for mut1 so span no longer equals correctedValue
  db._store.set("inboundEmailProcessing/inbound-imp-mut1", {
    combinedExtractedText: "Customer P/O #\nZZZ_WRONG\n",
    senderEmail: "orders@johnstone.com",
  });
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(r.outcome, "below_threshold");
  assert.equal(r.distinctDocumentCount, 2);
  assert.ok(r.skippedVotes >= 1);
  ok("mutated span text skips vote (dynamic evidence fail-closed)");
}

// fingerprint supersede — old proposed lesson suspended when votes move
{
  const db = createMemoryDb();
  const values = [
    { importId: "imp-sup1", correctedValue: "SUP1" },
    { importId: "imp-sup2", correctedValue: "SUP2" },
    { importId: "imp-sup3", correctedValue: "SUP3" },
  ];
  let scopeKey = "";
  for (const v of values) {
    scopeKey = seedExample(db, v); // stacked → anchor_above_line
  }
  const first = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(first.outcome, "proposed");
  const oldLessonId = first.lessonId;
  assert.ok(oldLessonId);
  assert.match(
    first.patternFingerprint,
    /anchor_above_line/,
    "first pattern is above-line",
  );

  // Rewrite all three imports to inline capture shape; refresh spans
  for (const v of values) {
    const extracted = `Customer P/O #: ${v.correctedValue} trailing\n`;
    const start = extracted.indexOf(v.correctedValue);
    db._store.set(`inboundEmailProcessing/inbound-${v.importId}`, {
      combinedExtractedText: extracted,
      senderEmail: "orders@johnstone.com",
    });
    const exKey = [...db._store.keys()].find(
      (k) =>
        k.startsWith("vendorInvoiceFieldLessonExamples/") &&
        db._store.get(k).vendorInvoiceImportId === v.importId,
    );
    assert.ok(exKey);
    const ex = db._store.get(exKey);
    ex.evidenceSpanStart = start;
    ex.evidenceSpanEnd = start + v.correctedValue.length;
    ex.evidenceCitationText = v.correctedValue;
    db._store.set(exKey, ex);
  }

  const second = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(second.outcome, "proposed");
  assert.match(second.patternFingerprint, /anchor_left_inline/);
  assert.notEqual(second.lessonId, oldLessonId);
  const oldLesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${oldLessonId}`,
  );
  assert.equal(oldLesson.status, "suspended");
  assert.equal(oldLesson.disabledReason, "superseded_by_winning_pattern");
  const newLesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${second.lessonId}`,
  );
  assert.equal(newLesson.status, "proposed");
  ok("fingerprint supersede suspends prior proposed lesson");
}

// D.2: active lesson → evaluate refresh is noop (not proposal_refreshed)
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-act1",
    correctedValue: "ACT1",
  });
  seedExample(db, { importId: "imp-act2", correctedValue: "ACT2" });
  seedExample(db, { importId: "imp-act3", correctedValue: "ACT3" });
  const first = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(first.outcome, "proposed");
  const lessonId = first.lessonId;
  const lessonRef = `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`;
  const cur = db._store.get(lessonRef);
  cur.status = "active";
  cur.version = 2;
  cur.activatedAt = new Date().toISOString();
  cur.activatedBy = "mgr1";
  db._store.set(lessonRef, cur);
  const second = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(second.outcome, "noop");
  assert.equal(db._store.get(lessonRef).status, "active");
  assert.equal(db._store.get(lessonRef).version, 2);
  ok("active lesson → evaluate noop (no refresh)");
}

// D.2: rejected lesson → evaluate noop
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-rej1",
    correctedValue: "REJ1",
  });
  seedExample(db, { importId: "imp-rej2", correctedValue: "REJ2" });
  seedExample(db, { importId: "imp-rej3", correctedValue: "REJ3" });
  const first = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  const lessonId = first.lessonId;
  const lessonRef = `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`;
  const cur = db._store.get(lessonRef);
  cur.status = "rejected";
  cur.version = 2;
  db._store.set(lessonRef, cur);
  const second = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(second.outcome, "noop");
  assert.equal(db._store.get(lessonRef).status, "rejected");
  ok("rejected lesson → evaluate noop (evaluator-inert)");
}

// D.2: contradiction auto-suspends active lesson
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-cx1",
    correctedValue: "CX1",
    extracted: "Customer P/O #\nCX1\nSales Order #\nSO\nInvoice #\nINV\n",
  });
  seedExample(db, {
    importId: "imp-cx2",
    correctedValue: "CX2",
    extracted: "Customer P/O #\nCX2\nSales Order #\nSO\nInvoice #\nINV\n",
  });
  seedExample(db, {
    importId: "imp-cx3",
    correctedValue: "CX3",
    extracted: "Customer P/O #\nCX3\nSales Order #\nSO\nInvoice #\nINV\n",
  });
  const first = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(first.outcome, "proposed");
  const lessonId = first.lessonId;
  const lessonRef = `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`;
  const cur = db._store.get(lessonRef);
  cur.status = "active";
  cur.version = 2;
  db._store.set(lessonRef, cur);

  // Add competing inline pattern on a 4th doc
  seedExample(db, {
    importId: "imp-cx4",
    correctedValue: "INLINE4",
    extracted: "Customer P/O #: INLINE4 trailing\nSales Order #\nSO\nInvoice #\nINV\n",
  });
  const exKey = [...db._store.keys()].find(
    (k) =>
      k.startsWith("vendorInvoiceFieldLessonExamples/") &&
      db._store.get(k).vendorInvoiceImportId === "imp-cx4",
  );
  const ex = db._store.get(exKey);
  const extracted = db._store.get("inboundEmailProcessing/inbound-imp-cx4")
    .combinedExtractedText;
  const start = extracted.indexOf("INLINE4");
  ex.evidenceSpanStart = start;
  ex.evidenceSpanEnd = start + "INLINE4".length;
  db._store.set(exKey, ex);

  const second = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(second.outcome, "contradiction_auto_suspended");
  assert.equal(db._store.get(lessonRef).status, "suspended");
  assert.equal(db._store.get(lessonRef).disabledReason, "contradictory_evidence");
  ok("contradiction auto-suspends active lesson");
}

// D.2: threshold decay auto-suspends active when votes drop
{
  const db = createMemoryDb();
  const scopeKey = seedExample(db, {
    importId: "imp-th1",
    correctedValue: "TH1",
  });
  seedExample(db, { importId: "imp-th2", correctedValue: "TH2" });
  seedExample(db, { importId: "imp-th3", correctedValue: "TH3" });
  const first = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  const lessonId = first.lessonId;
  const lessonRef = `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`;
  const cur = db._store.get(lessonRef);
  cur.status = "active";
  cur.version = 2;
  db._store.set(lessonRef, cur);

  // Expire two examples so only 1 vote remains
  for (const imp of ["imp-th2", "imp-th3"]) {
    const exKey = [...db._store.keys()].find(
      (k) =>
        k.startsWith("vendorInvoiceFieldLessonExamples/") &&
        db._store.get(k).vendorInvoiceImportId === imp,
    );
    const ex = db._store.get(exKey);
    ex.archiveAfterAt = timestampFromMillis(Date.now() - 1000);
    db._store.set(exKey, ex);
  }

  const second = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "mgr1",
  });
  assert.equal(second.outcome, "threshold_auto_suspended");
  assert.equal(db._store.get(lessonRef).status, "suspended");
  assert.equal(
    db._store.get(lessonRef).disabledReason,
    "eligible_votes_below_threshold",
  );
  ok("threshold decay auto-suspends active lesson");
}

console.log(`\nevaluate-field-lesson-candidate: ${passed} passed`);
