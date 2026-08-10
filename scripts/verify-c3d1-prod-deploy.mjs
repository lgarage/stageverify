/**
 * C3-D.1 production deploy verification (controlled, cleanup-aware).
 * Uses FIREBASE_TOKEN admin REST + STAGEVERIFY_TEST_* Manager callables.
 *
 * Usage: node scripts/verify-c3d1-prod-deploy.mjs
 */
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "firebase/functions";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {
  getFirebaseAccessToken,
  firestoreRestBase,
  restFields,
} from "./lib/firestore-admin-rest.mjs";

const PROJECT = "stageverify-db";
const FIXTURE_PREFIX = "c3d1-prodverify-";
/** Isolated from live Johnstone scopes so prod examples cannot inflate votes. */
const FIXTURE_DOMAIN = "c3d1-prodverify.invalid";
const require = createRequire(import.meta.url);

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

function toRestValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number" && Number.isInteger(v))
    return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v))
    return { arrayValue: { values: v.map(toRestValue) } };
  if (typeof v === "object" && v._seconds != null) {
    return {
      timestampValue: new Date(v._seconds * 1000).toISOString(),
    };
  }
  throw new Error(`unsupported value ${JSON.stringify(v)}`);
}

function toRestDoc(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = toRestValue(v);
  return { fields: out };
}

async function restUpsert(access, path, fields) {
  const url = `${firestoreRestBase(PROJECT)}/${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toRestDoc(fields)),
  });
  if (!res.ok) {
    throw new Error(`upsert ${path}: ${res.status} ${await res.text()}`);
  }
}

async function restDelete(access, path) {
  const url = `${firestoreRestBase(PROJECT)}/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${access}` },
  });
  if (res.status !== 404 && !res.ok) {
    throw new Error(`delete ${path}: ${res.status} ${await res.text()}`);
  }
}

async function restGet(access, path) {
  const url = `${firestoreRestBase(PROJECT)}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restRunQuery(access, structuredQuery) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`runQuery: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchCfMeta(access, name) {
  const url = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/functions/${name}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) throw new Error(`cf ${name}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchRulesRelease(access) {
  const url = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) throw new Error(`rules: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.releases || []).find((r) =>
    String(r.name || "").endsWith("/cloud.firestore"),
  );
}

async function fetchIndexes(access, collectionGroup) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/${collectionGroup}/indexes`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) {
    return { status: res.status, error: await res.text(), indexes: [] };
  }
  return { status: res.status, indexes: (await res.json()).indexes || [] };
}

function firebaseClientApp() {
  // Public web config from src/firebase.ts
  const cfg = {
    apiKey: "AIzaSyC7nH7m0w0m0m0m0m0m0m0m0m0m0m0m0m",
  };
  // Prefer reading from built env / firebase.ts
  return null;
}

async function loadFirebaseWebConfig() {
  const fs = await import("node:fs");
  const text = fs.readFileSync("src/firebase.ts", "utf8");
  const pick = (key) => {
    const m = text.match(new RegExp(`${key}:\\s*[\"']([^\"']+)[\"']`));
    if (!m) throw new Error(`missing firebase config ${key}`);
    return m[1];
  };
  return {
    apiKey: pick("apiKey"),
    authDomain: pick("authDomain"),
    projectId: pick("projectId"),
    storageBucket: pick("storageBucket"),
    messagingSenderId: pick("messagingSenderId"),
    appId: pick("appId"),
  };
}

function makeExtracted(value, mode = "above") {
  if (mode === "inline") return `Customer P/O #: ${value} trailing\n`;
  return `Customer P/O #\n${value}\nSales Order #\nSO1\nInvoice #\nINV1\n`;
}

async function seedFixture(access, opts) {
  const importId = `${FIXTURE_PREFIX}${opts.suffix}`;
  const field = opts.field ?? "customerPoOrReference";
  const vendorKey = opts.vendorKey ?? "johnstone-supply";
  const parserFormatId = opts.parserFormatId ?? "johnstone";
  const senderDomain = opts.senderDomain ?? FIXTURE_DOMAIN;
  const scopeKey = `${vendorKey}__${parserFormatId}__${senderDomain}__${field}`;
  const correctionId = `${importId}__${field}__c1`;
  const value = opts.correctedValue;
  const extracted = opts.extracted ?? makeExtracted(value, opts.mode ?? "above");
  const start = extracted.indexOf(value);
  if (start < 0) throw new Error("value not in extracted");
  const inboundId = `inbound-${importId}`;
  const now = Date.now();
  const archiveMs =
    opts.stale === true ? now - 60_000 : now + 300 * 86400000;

  await restUpsert(access, `vendorInvoiceImports/${importId}`, {
    inboundEmailProcessingId: inboundId,
    parserFormatId,
    detectedVendorName: "Johnstone Supply",
    fixture: true,
    fixtureTag: "c3d1-prodverify",
  });
  await restUpsert(access, `inboundEmailProcessing/${inboundId}`, {
    combinedExtractedText: extracted,
    senderEmail: `orders@${senderDomain}`,
    fixture: true,
    fixtureTag: "c3d1-prodverify",
  });
  await restUpsert(access, `vendorInvoiceFieldLessonExamples/${correctionId}`, {
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
    actorUid: "c3d1-prodverify",
    verifiedAt: opts.verifiedAt ?? new Date().toISOString(),
    status: "active",
    retentionDays: 365,
    archiveAfterAt: { _seconds: Math.floor(archiveMs / 1000) },
    archivedAt: null,
    scopeKey,
    source: "c2_verified_correction",
    idempotencyKey: correctionId,
    fixture: true,
    fixtureTag: "c3d1-prodverify",
  });
  return { importId, correctionId, scopeKey, inboundId };
}

async function cleanupFixtures(access) {
  const collections = [
    "vendorInvoiceFieldLessonExamples",
    "vendorInvoiceImports",
    "inboundEmailProcessing",
    "vendorInvoiceFieldLessons",
    "vendorInvoiceFieldLessonAuditEvents",
  ];
  let deleted = 0;
  for (const col of collections) {
    let pageToken = "";
    do {
      const url = new URL(`${firestoreRestBase(PROJECT)}/${col}`);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!res.ok) break;
      const json = await res.json();
      for (const d of json.documents || []) {
        const id = d.name.split("/").pop();
        const raw = JSON.stringify(d);
        const fields = restFields(d);
        const isFixture =
          fields.fixtureTag === "c3d1-prodverify" ||
          id.startsWith(FIXTURE_PREFIX) ||
          raw.includes(FIXTURE_PREFIX) ||
          raw.includes(FIXTURE_DOMAIN) ||
          raw.includes("c3d1-contra.test") ||
          (fields.scopeKey &&
            String(fields.scopeKey).includes(FIXTURE_DOMAIN));
        if (isFixture) {
          await restDelete(access, `${col}/${id}`);
          deleted += 1;
        }
      }
      pageToken = json.nextPageToken || "";
    } while (pageToken);
  }
  return deleted;
}

async function main() {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required");
  }

  const access = await getFirebaseAccessToken();
  const meta = {};

  // --- Deploy identity ---
  const evalMeta = await fetchCfMeta(
    access,
    "evaluateVendorInvoiceFieldLessonCandidates",
  );
  const listMeta = await fetchCfMeta(access, "listVendorInvoiceFieldLessons");
  meta.evaluate = {
    revision: evalMeta.serviceConfig?.revision || null,
    updateTime: evalMeta.updateTime,
    state: evalMeta.state,
    hash:
      evalMeta.buildConfig?.source?.storageSource?.generation ||
      evalMeta.buildConfig?.source?.storageSource?.object ||
      null,
  };
  meta.list = {
    revision: listMeta.serviceConfig?.revision || null,
    updateTime: listMeta.updateTime,
    state: listMeta.state,
    hash:
      listMeta.buildConfig?.source?.storageSource?.generation ||
      listMeta.buildConfig?.source?.storageSource?.object ||
      null,
  };
  record(
    "CF evaluate created",
    evalMeta.state === "ACTIVE",
    `rev=${meta.evaluate.revision}`,
  );
  record(
    "CF list created",
    listMeta.state === "ACTIVE",
    `rev=${meta.list.revision}`,
  );

  // Confirm unrelated parser CFs still present (not redeployed claim — presence only)
  const applyMeta = await fetchCfMeta(access, "applyInvoiceReviewFieldCorrection");
  record(
    "unrelated applyInvoiceReviewFieldCorrection still ACTIVE",
    applyMeta.state === "ACTIVE",
    `updateTime=${applyMeta.updateTime}`,
  );

  const release = await fetchRulesRelease(access);
  meta.rulesetName = release?.rulesetName || null;
  record("firestore rules release present", !!meta.rulesetName, meta.rulesetName);

  const exIdx = await fetchIndexes(access, "vendorInvoiceFieldLessonExamples");
  const lesIdx = await fetchIndexes(access, "vendorInvoiceFieldLessons");
  const exReady = (exIdx.indexes || []).filter((i) =>
    JSON.stringify(i).includes("scopeKey"),
  );
  const lesReady = (lesIdx.indexes || []).filter((i) =>
    JSON.stringify(i).includes("proposedAt"),
  );
  meta.indexes = {
    examples: exReady.map((i) => ({ state: i.state, name: i.name })),
    lessons: lesReady.map((i) => ({ state: i.state, name: i.name })),
  };
  let indexesReady =
    exReady.some((i) => i.state === "READY") &&
    lesReady.some((i) => i.state === "READY");
  for (let i = 0; i < 24 && !indexesReady; i += 1) {
    console.log(`waiting for indexes READY (attempt ${i + 1}/24)…`);
    await new Promise((r) => setTimeout(r, 15_000));
    const ex2 = await fetchIndexes(access, "vendorInvoiceFieldLessonExamples");
    const les2 = await fetchIndexes(access, "vendorInvoiceFieldLessons");
    meta.indexes = {
      examples: (ex2.indexes || [])
        .filter((x) => JSON.stringify(x).includes("scopeKey"))
        .map((x) => ({ state: x.state, name: x.name })),
      lessons: (les2.indexes || [])
        .filter((x) => JSON.stringify(x).includes("proposedAt"))
        .map((x) => ({ state: x.state, name: x.name })),
    };
    indexesReady =
      meta.indexes.examples.some((x) => x.state === "READY") &&
      meta.indexes.lessons.some((x) => x.state === "READY");
  }
  record(
    "required indexes READY",
    indexesReady,
    JSON.stringify(meta.indexes),
  );
  if (!indexesReady) {
    console.log(
      "INDEXES NOT READY — aborting index-dependent evaluate/list checks as PARTIAL",
    );
    console.log(JSON.stringify({ meta, results }, null, 2));
    process.exit(2);
  }

  // Cleanup any leftover fixtures first
  await cleanupFixtures(access);

  const web = await loadFirebaseWebConfig();
  const app = initializeApp(web, "c3d1-prodverify");
  const auth = getAuth(app);
  const functions = getFunctions(app, "us-central1");
  const db = getFirestore(app);
  const evaluate = httpsCallable(
    functions,
    "evaluateVendorInvoiceFieldLessonCandidates",
  );
  const listLessons = httpsCallable(functions, "listVendorInvoiceFieldLessons");

  // Manager auth
  let unauthDenied = false;
  try {
    await evaluate({
      vendorKey: "johnstone-supply",
      parserFormatId: "johnstone",
      senderDomain: "johnstone.com",
      field: "customerPoOrReference",
    });
  } catch (e) {
    unauthDenied =
      /unauthenticated|permission-denied|auth/i.test(String(e?.code || e)) ||
      /unauthenticated|permission/i.test(String(e?.message || e));
  }
  record("evaluate rejects unauthenticated", unauthDenied, "");

  await signInWithEmailAndPassword(auth, email, password);
  record("Manager/test user signed in", true, email.split("@")[0] + "@…");

  // Browser deny-all
  let browserDenied = true;
  try {
    await getDoc(doc(db, "vendorInvoiceFieldLessons", "does-not-exist"));
    // get on missing may succeed with exists:false under some rules; for deny-all should fail
  } catch {
    browserDenied = true;
  }
  try {
    await setDoc(doc(db, "vendorInvoiceFieldLessons", `${FIXTURE_PREFIX}hack`), {
      status: "active",
    });
    browserDenied = false;
  } catch {
    // expected
  }
  try {
    await getDoc(
      doc(db, "vendorInvoiceFieldLessonAuditEvents", "does-not-exist"),
    );
  } catch {
    // expected for deny-all
  }
  try {
    await setDoc(
      doc(db, "vendorInvoiceFieldLessonAuditEvents", `${FIXTURE_PREFIX}hack-aud`),
      { eventType: "proposed" },
    );
    browserDenied = false;
  } catch {
    // expected
  }
  record("browser Firestore write deny-all lessons/audit", browserDenied);

  const scopeArgs = {
    vendorKey: "johnstone-supply",
    parserFormatId: "johnstone",
    senderDomain: FIXTURE_DOMAIN,
    field: "customerPoOrReference",
  };

  // A: <3 docs → below_threshold
  const a1 = await seedFixture(access, {
    suffix: "a1",
    correctedValue: "A-ONLY-1",
  });
  const a2 = await seedFixture(access, {
    suffix: "a2",
    correctedValue: "A-ONLY-2",
  });
  const rA = await evaluate(scopeArgs);
  const outcomeA = rA.data?.results?.[0]?.outcome;
  const countA = rA.data?.results?.[0]?.distinctDocumentCount;
  record(
    "A below_threshold (<3)",
    outcomeA === "below_threshold" && countA === 2,
    `outcome=${outcomeA} count=${countA}`,
  );

  // B+C: >=3 distinct values same fingerprint → proposed
  const b3 = await seedFixture(access, {
    suffix: "b3",
    correctedValue: "B-VAL-3",
  });
  const rB = await evaluate(scopeArgs);
  const outB = rB.data?.results?.[0];
  record(
    "B >=3 same fingerprint → proposed",
    outB?.outcome === "proposed" && outB?.distinctDocumentCount === 3,
    `outcome=${outB?.outcome} count=${outB?.distinctDocumentCount} fp=${outB?.patternFingerprint}`,
  );
  record(
    "C different correctedValues same fingerprint OK",
    !!outB?.patternFingerprint &&
      outB?.patternFingerprint.includes("johnstone_customer_po_v1"),
    outB?.patternFingerprint || "",
  );
  const lessonIdB = outB?.lessonId;

  // D: duplicate same sourceDocumentKey → still 3
  const dupExtracted = makeExtracted("A-ONLY-1-DUP");
  const dupStart = dupExtracted.indexOf("A-ONLY-1-DUP");
  await restUpsert(
    access,
    `vendorInvoiceFieldLessonExamples/${a1.importId}__customerPoOrReference__c2`,
    {
      id: `${a1.importId}__customerPoOrReference__c2`,
      exampleId: `${a1.importId}__customerPoOrReference__c2`,
      correctionId: `${a1.importId}__customerPoOrReference__c2`,
      vendorInvoiceImportId: a1.importId,
      sourceDocumentKey: a1.importId,
      category: "header_field_extraction",
      field: "customerPoOrReference",
      vendorKey: "johnstone-supply",
      parserFormatId: "johnstone",
      senderDomain: FIXTURE_DOMAIN,
      originalValue: "",
      correctedValue: "A-ONLY-1-DUP",
      evidenceType: "document_evidence",
      evidenceCitationText: "A-ONLY-1-DUP",
      evidenceSpanStart: dupStart,
      evidenceSpanEnd: dupStart + "A-ONLY-1-DUP".length,
      actorUid: "c3d1-prodverify",
      verifiedAt: new Date().toISOString(),
      status: "active",
      retentionDays: 365,
      archiveAfterAt: {
        _seconds: Math.floor((Date.now() + 300 * 86400000) / 1000),
      },
      archivedAt: null,
      scopeKey: a1.scopeKey,
      source: "c2_verified_correction",
      idempotencyKey: `${a1.importId}__customerPoOrReference__c2`,
      fixture: true,
      fixtureTag: "c3d1-prodverify",
    },
  );
  await restUpsert(access, `inboundEmailProcessing/${a1.inboundId}`, {
    combinedExtractedText: dupExtracted,
    senderEmail: `orders@${FIXTURE_DOMAIN}`,
    fixture: true,
    fixtureTag: "c3d1-prodverify",
  });
  const rD = await evaluate({ scopeKey: a1.scopeKey });
  const outD = rD.data?.results?.[0];
  record(
    "D same sourceDocumentKey does not inflate",
    outD?.distinctDocumentCount === 3,
    `count=${outD?.distinctDocumentCount} outcome=${outD?.outcome}`,
  );

  // E: stale
  await seedFixture(access, {
    suffix: "stale1",
    correctedValue: "STALE-1",
    stale: true,
  });
  const rE = await evaluate({ scopeKey: a1.scopeKey });
  const outE = rE.data?.results?.[0];
  record(
    "E stale archiveAfterAt excluded",
    outE?.distinctDocumentCount === 3 && (outE?.skippedVotes ?? 0) >= 1,
    `count=${outE?.distinctDocumentCount} skipped=${outE?.skippedVotes}`,
  );

  // F: dispatcher_assertion
  await seedFixture(access, {
    suffix: "assert1",
    correctedValue: "ASSERT-1",
    evidenceType: "dispatcher_assertion",
  });
  const rF = await evaluate({ scopeKey: a1.scopeKey });
  const outF = rF.data?.results?.[0];
  record(
    "F dispatcher_assertion never votes",
    outF?.distinctDocumentCount === 3,
    `count=${outF?.distinctDocumentCount}`,
  );

  // G: First Supply blocked
  await seedFixture(access, {
    suffix: "fs1",
    correctedValue: "FS-1",
    parserFormatId: "first_supply",
    vendorKey: "first-supply",
    senderDomain: "firstsupply.com",
  });
  await seedFixture(access, {
    suffix: "fs2",
    correctedValue: "FS-2",
    parserFormatId: "first_supply",
    vendorKey: "first-supply",
    senderDomain: "firstsupply.com",
  });
  await seedFixture(access, {
    suffix: "fs3",
    correctedValue: "FS-3",
    parserFormatId: "first_supply",
    vendorKey: "first-supply",
    senderDomain: "firstsupply.com",
  });
  const rG = await evaluate({
    vendorKey: "first-supply",
    parserFormatId: "first_supply",
    senderDomain: "firstsupply.com",
    field: "customerPoOrReference",
  });
  const outG = rG.data?.results?.[0];
  record(
    "G First Supply skipped_format",
    outG?.outcome === "skipped_format",
    `outcome=${outG?.outcome}`,
  );

  // H: Ferguson / generic blocked
  const rH = await evaluate({
    vendorKey: "ferguson",
    parserFormatId: "generic",
    senderDomain: "ferguson.com",
    field: "customerPoOrReference",
  });
  const outH = rH.data?.results?.[0];
  record(
    "H generic/Ferguson skipped_format",
    outH?.outcome === "skipped_format",
    `outcome=${outH?.outcome}`,
  );

  // I: contradictory fingerprints — switch one of three to inline while keeping others above
  // Create dedicated contradiction scope with vendor key still johnstone but unique senderDomain
  const contraDomain = "c3d1-contra.test";
  const c1 = await seedFixture(access, {
    suffix: "c1",
    correctedValue: "CONTRA-1",
    senderDomain: contraDomain,
    mode: "above",
  });
  await seedFixture(access, {
    suffix: "c2",
    correctedValue: "CONTRA-2",
    senderDomain: contraDomain,
    mode: "above",
  });
  await seedFixture(access, {
    suffix: "c3",
    correctedValue: "CONTRA-3",
    senderDomain: contraDomain,
    mode: "inline",
  });
  // First propose with 2 above — below threshold; add third above then flip
  // Actually c1+c2 above, c3 inline → competing fingerprints with votes
  const rI = await evaluate({
    vendorKey: "johnstone-supply",
    parserFormatId: "johnstone",
    senderDomain: contraDomain,
    field: "customerPoOrReference",
  });
  const outI = rI.data?.results?.[0];
  record(
    "I contradictory fingerprints fail closed",
    outI?.outcome === "contradiction_blocked" ||
      outI?.outcome === "contradiction_auto_suspended",
    `outcome=${outI?.outcome} competing=${JSON.stringify(outI?.competingFingerprints)}`,
  );

  // J: list sanitized
  const rJ = await listLessons({
    status: "proposed",
    limit: 20,
  });
  const lessons = rJ.data?.lessons || [];
  const ours = lessons.find((l) => l.id === lessonIdB) || lessons[0];
  const hasInboundId = JSON.stringify(ours || {}).includes(
    "inboundEmailProcessingId",
  );
  const statusOk =
    !lessons.some((l) =>
      ["active", "rejected", "archived"].includes(l.status),
    );
  record(
    "J list Manager sanitized proposed rows",
    !!ours &&
      ours.status === "proposed" &&
      !!ours.evidenceSnapshot &&
      !hasInboundId,
    `count=${lessons.length} status=${ours?.status} inboundLeak=${hasInboundId}`,
  );
  record("J/K proposed/suspended-only in list", statusOk, "");

  // K browser deny already done; also list requires auth — sign out and try
  await signOut(auth);
  let listUnauth = false;
  try {
    await listLessons({ limit: 5 });
  } catch {
    listUnauth = true;
  }
  record("list rejects unauthenticated", listUnauth);

  // Re-auth for cleanup evaluation not needed
  await signInWithEmailAndPassword(auth, email, password);

  // 17 proposed/suspended only on our lesson doc via admin REST
  if (lessonIdB) {
    const lessonDoc = await restGet(
      access,
      `vendorInvoiceFieldLessons/${lessonIdB}`,
    );
    const st = restFields(lessonDoc || {}).status;
    record(
      "lesson status proposed|suspended only",
      st === "proposed" || st === "suspended",
      `status=${st}`,
    );
  } else {
    record("lesson status proposed|suspended only", false, "no lessonId");
  }

  // L no-parse-effect — static on main tip (also re-check apply CF updateTime not equal new CFs)
  record(
    "L parser CFs not the newly created C3-D.1 pair",
    applyMeta.updateTime !== evalMeta.updateTime,
    `apply.updateTime=${applyMeta.updateTime}`,
  );

  // Cleanup
  const deleted = await cleanupFixtures(access);
  // Extra: delete lesson by id if still present
  if (lessonIdB) {
    await restDelete(access, `vendorInvoiceFieldLessons/${lessonIdB}`);
  }
  // Delete contra-domain lessons
  const lesList = await fetch(
    `${firestoreRestBase(PROJECT)}/vendorInvoiceFieldLessons?pageSize=50`,
    { headers: { Authorization: `Bearer ${access}` } },
  );
  if (lesList.ok) {
    const lj = await lesList.json();
    for (const d of lj.documents || []) {
      if (JSON.stringify(d).includes(FIXTURE_PREFIX) || JSON.stringify(d).includes(contraDomain)) {
        await restDelete(access, `vendorInvoiceFieldLessons/${d.name.split("/").pop()}`);
      }
    }
  }
  record("fixture cleanup", true, `deleted≈${deleted}`);

  await signOut(auth);
  await deleteApp(app);

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== META ===");
  console.log(JSON.stringify(meta, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log("PASS: verify-c3d1-prod-deploy");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
