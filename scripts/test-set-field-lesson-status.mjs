/**
 * Lane C C3-D.2 — lifecycle activate/reject/suspend/reactivate (memory Firestore).
 * Usage: npm run test:set-field-lesson-status
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

function timestampFromMillis(ms) {
  return { seconds: Math.floor(ms / 1000), nanoseconds: 0 };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(__dirname, "..", "functions", "lib", "invoice", "reviewChat");
const lifecycleMod = await import(
  pathToFileURL(path.join(lib, "fieldLessonLifecycle.js")).href
);
const lessonsMod = await import(
  pathToFileURL(path.join(lib, "vendorInvoiceFieldLessons.js")).href
);
const evalMod = await import(
  pathToFileURL(path.join(lib, "evaluateFieldLessonCandidate.js")).href
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
          .filter(
            ([k]) =>
              k.startsWith(prefix) && !k.slice(prefix.length).includes("/"),
          )
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
    evidenceType: "document_evidence",
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

async function proposeLesson(db) {
  const scopeKey = seedExample(db, {
    importId: "lc-a",
    correctedValue: "2205 EARLY",
  });
  seedExample(db, { importId: "lc-b", correctedValue: "7842" });
  seedExample(db, { importId: "lc-c", correctedValue: "ACME-1934" });
  const r = await evalMod.evaluateFieldLessonScope({
    db,
    scope: evalMod.parseScopeKey(scopeKey),
    actorUid: "eval-actor",
  });
  assert.equal(r.outcome, "proposed");
  return { lessonId: r.lessonId, scopeKey };
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// activate proposed → active with revalidation
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  const lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "activate",
      expectedVersion: lesson.version,
      idempotencyKey: "act-1",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "active");
  assert.equal(r.result.alreadyApplied, false);
  assert.equal(r.result.revalidationPassed, true);
  const updated = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  assert.equal(updated.status, "active");
  assert.ok(updated.activatedAt);
  assert.ok(updated.lastRevalidation);
  assert.equal(updated.extractionPattern.captureShapeNote, "bounded_token_near_anchor");
  ok("activate proposed → active (revalidation pass)");
}

// reject proposed → rejected
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  const lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "reject",
      expectedVersion: lesson.version,
      idempotencyKey: "rej-1",
      note: "Not confident enough",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "rejected");
  const updated = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  assert.equal(updated.rejectionNote, "Not confident enough");
  ok("reject proposed → rejected");
}

// suspend active → suspended
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  let lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "activate",
      expectedVersion: lesson.version,
      idempotencyKey: "act-s",
      actorUid: "mgr1",
    },
  });
  lesson = db._store.get(`${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`);
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "suspend",
      expectedVersion: lesson.version,
      idempotencyKey: "sus-1",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "suspended");
  const updated = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  assert.equal(updated.disabledReason, "manual_suspend");
  ok("suspend active → suspended");
}

// reactivate suspended → active
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  let lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "activate",
      expectedVersion: lesson.version,
      idempotencyKey: "act-r",
      actorUid: "mgr1",
    },
  });
  lesson = db._store.get(`${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`);
  await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "suspend",
      expectedVersion: lesson.version,
      idempotencyKey: "sus-r",
      actorUid: "mgr1",
    },
  });
  lesson = db._store.get(`${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`);
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "reactivate",
      expectedVersion: lesson.version,
      idempotencyKey: "react-1",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "active");
  assert.equal(r.result.revalidationPassed, true);
  ok("reactivate suspended → active");
}

// version conflict
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "reject",
      expectedVersion: 999,
      idempotencyKey: "ver-1",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "lesson_version_mismatch");
  ok("version mismatch → failed-precondition");
}

// idempotency replay
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  const lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  const req = {
    lessonId,
    action: "reject",
    expectedVersion: lesson.version,
    idempotencyKey: "idem-1",
    actorUid: "mgr1",
  };
  const first = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: req,
  });
  assert.equal(first.ok, true);
  const second = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: req,
  });
  assert.equal(second.ok, true);
  assert.equal(second.result.alreadyApplied, true);
  ok("idempotency replay → alreadyApplied");
}

// illegal transition activate from active
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  let lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "activate",
      expectedVersion: lesson.version,
      idempotencyKey: "act-ill",
      actorUid: "mgr1",
    },
  });
  lesson = db._store.get(`${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`);
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "activate",
      expectedVersion: lesson.version,
      idempotencyKey: "act-ill2",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "invalid_transition");
  ok("illegal activate from active");
}

// revalidation fail — corrupt live text for one vote
{
  const db = createMemoryDb();
  const { lessonId } = await proposeLesson(db);
  db._store.set("inboundEmailProcessing/inbound-lc-a", {
    combinedExtractedText: "Customer P/O #\nCORRUPTED\n",
    senderEmail: "orders@johnstone.com",
  });
  const lesson = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  const r = await lifecycleMod.applyFieldLessonStatusTransition({
    db,
    request: {
      lessonId,
      action: "activate",
      expectedVersion: lesson.version,
      idempotencyKey: "fail-reval",
      actorUid: "mgr1",
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "revalidation_failed");
  const unchanged = db._store.get(
    `${lessonsMod.FIELD_LESSON_COLLECTION}/${lessonId}`,
  );
  assert.equal(unchanged.status, "proposed");
  ok("revalidation fail → no status mutation");
}

console.log(`\nset-field-lesson-status: ${passed} passed`);
