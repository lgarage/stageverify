/**
 * recordTechnicianJobOpen CF authority tests (Firestore + Functions emulators).
 * Usage: npm run test:technician-job-open
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

const clientApp = initializeApp({ projectId: PROJECT_ID });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const recordTechnicianJobOpen = httpsCallable(
  functions,
  "recordTechnicianJobOpen",
);

const TECH_ID = "tech-1";
const JOB_ID = "job-released-1";
const SESSION_TOKEN = "a".repeat(64);
const RELEASE_DATE = new Date().toISOString().slice(0, 10);

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
}

function expectError(err, codeSubstring) {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "");
  return code.includes(codeSubstring) || message.includes(codeSubstring);
}

async function seed(setup) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setup(ctx.firestore());
  });
}

async function readJobOpenEvent(clientOpenId) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(
      doc(ctx.firestore(), "pinVerificationEvents", `job-open-${clientOpenId}`),
    );
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

async function readPinEvent(eventId) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(
      doc(ctx.firestore(), "pinVerificationEvents", eventId),
    );
    data = snap.exists() ? snap.data() : null;
  });
  return data;
}

async function countTechJobOpenedEvents() {
  let count = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(
      collection(ctx.firestore(), "pinVerificationEvents"),
    );
    for (const d of snap.docs) {
      if (d.data().action === "TECH_JOB_OPENED") count++;
    }
  });
  return count;
}

async function seedTechnicianSession(
  db,
  {
    sessionToken = SESSION_TOKEN,
    technicianId = TECH_ID,
    technicianName = "Test Tech",
    expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
    scannedStagingLocationCode = "STAGE-A",
  } = {},
) {
  await setDoc(doc(db, "technicianSessions", sessionToken), {
    id: sessionToken,
    technicianId,
    technicianName,
    expiresAt,
    createdAt: new Date().toISOString(),
    scannedStagingLocationCode,
  });
}

async function seedDayRelease(
  db,
  {
    technicianId = TECH_ID,
    jobIds = [JOB_ID],
    releaseDate = RELEASE_DATE,
  } = {},
) {
  const docId = `${technicianId}_${releaseDate}`;
  await setDoc(doc(db, "technicianDayReleases", docId), {
    technicianId,
    releaseDate,
    jobIds,
  });
}

async function seedDeliveriesForJob(db, jobId, deliverySpecs) {
  for (const spec of deliverySpecs) {
    await setDoc(doc(db, "deliveries", spec.id), {
      id: spec.id,
      jobId,
      status: spec.status,
      orderNumber: `ORD-${spec.id}`,
      vendorId: "vendor-1",
      vendorOrderComplete: spec.vendorOrderComplete ?? false,
      vendorPhysicalDropoffConfirmed: spec.vendorPhysicalDropoffConfirmed ?? false,
      stagingLocationId: spec.stagingLocationId ?? "",
      additionalStagingLocationIds: spec.additionalStagingLocationIds ?? [],
      plannedStagingLocationIds: spec.plannedStagingLocationIds ?? [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const itemSpecs = spec.items ?? [
      {
        id: `${spec.id}-item-0`,
        qtyOrdered: 1,
        qtyReceived: spec.status === "ready_for_pickup" ? 1 : 0,
        qtyMissing: spec.status === "ready_for_pickup" ? 0 : 1,
        qtyDamaged: 0,
        qtyBackordered: 0,
      },
    ];
    for (const item of itemSpecs) {
      await setDoc(doc(db, "items", item.id), {
        id: item.id,
        deliveryOrderId: spec.id,
        description: "Test item",
        qtyOrdered: item.qtyOrdered,
        qtyReceived: item.qtyReceived,
        qtyMissing: item.qtyMissing,
        qtyDamaged: item.qtyDamaged,
        qtyBackordered: item.qtyBackordered,
        status: item.qtyReceived === item.qtyOrdered ? "received" : "partial",
      });
    }
  }
}

async function callOpen(overrides = {}) {
  return recordTechnicianJobOpen({
    sessionToken: SESSION_TOKEN,
    jobId: JOB_ID,
    clientOpenId: "open-id-001",
    ...overrides,
  });
}

console.log("\n=== recordTechnicianJobOpen authority ===\n");

try {
  // T1 — valid write with readiness 3/2
  await seed(async (db) => {
    await seedTechnicianSession(db);
    await seedDayRelease(db);
    await seedDeliveriesForJob(db, JOB_ID, [
      {
        id: "del-r1",
        status: "ready_for_pickup",
        vendorOrderComplete: true,
        vendorPhysicalDropoffConfirmed: true,
        stagingLocationId: "loc-g1",
      },
      {
        id: "del-r2",
        status: "ready_for_pickup",
        vendorOrderComplete: true,
        vendorPhysicalDropoffConfirmed: true,
        stagingLocationId: "loc-g2",
      },
      {
        id: "del-p1",
        status: "partial",
        vendorOrderComplete: false,
        vendorPhysicalDropoffConfirmed: true,
        stagingLocationId: "loc-g3",
      },
    ]);
  });

  const t1ClientOpenId = "open-t1-valid";
  const t1 = await callOpen({ clientOpenId: t1ClientOpenId });
  const t1Event = await readJobOpenEvent(t1ClientOpenId);
  if (
    t1.data.duplicate === false &&
    t1Event?.action === "TECH_JOB_OPENED" &&
    t1Event.readinessSnapshot?.deliveryCount === 3 &&
    t1Event.readinessSnapshot?.readyForPickupCount === 2
  ) {
    pass("T1 valid → event with readiness 3/2");
  } else {
    fail("T1 valid write", new Error(JSON.stringify({ t1: t1.data, t1Event })));
  }

  // T2 — same clientOpenId → duplicate, one doc
  const t2a = await callOpen({ clientOpenId: t1ClientOpenId });
  const t2EventAgain = await readJobOpenEvent(t1ClientOpenId);
  if (t2a.data.duplicate === true && t2EventAgain?.clientOpenId === t1ClientOpenId) {
    pass("T2 same clientOpenId → duplicate true, one doc");
  } else {
    fail("T2 idempotent retry", new Error(JSON.stringify({ t2a: t2a.data, t2EventAgain })));
  }

  // T3 — new clientOpenId → second event
  const t3ClientOpenId = "open-t3-second";
  const t3 = await callOpen({ clientOpenId: t3ClientOpenId });
  const t3Count = await countTechJobOpenedEvents();
  if (t3.data.duplicate === false && t3Count === 2) {
    pass("T3 new clientOpenId → second event");
  } else {
    fail("T3 second open", new Error(JSON.stringify({ t3: t3.data, t3Count })));
  }

  // T4 — unreleased job → permission-denied
  try {
    await callOpen({ jobId: "job-not-released", clientOpenId: "open-t4" });
    fail("T4 unreleased job should throw");
  } catch (err) {
    if (expectError(err, "permission-denied")) {
      pass("T4 unreleased job → permission-denied");
    } else {
      fail("T4 wrong error", err);
    }
  }

  // T5 — expired session → permission-denied
  const expiredToken = "b".repeat(64);
  await seed(async (db) => {
    await seedTechnicianSession(db, {
      sessionToken: expiredToken,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await seedDayRelease(db);
  });
  try {
    await callOpen({ sessionToken: expiredToken, clientOpenId: "open-t5" });
    fail("T5 expired session should throw");
  } catch (err) {
    if (expectError(err, "permission-denied")) {
      pass("T5 expired session → permission-denied");
    } else {
      fail("T5 wrong error", err);
    }
  }

  // T6 — invalid session token → invalid-argument
  try {
    await callOpen({ sessionToken: "not-valid", clientOpenId: "open-t6" });
    fail("T6 invalid session token should throw");
  } catch (err) {
    if (expectError(err, "invalid-argument")) {
      pass("T6 invalid session token → invalid-argument");
    } else {
      fail("T6 wrong error", err);
    }
  }

  // T7 — missing clientOpenId → invalid-argument
  try {
    await recordTechnicianJobOpen({
      sessionToken: SESSION_TOKEN,
      jobId: JOB_ID,
    });
    fail("T7 missing clientOpenId should throw");
  } catch (err) {
    if (expectError(err, "invalid-argument")) {
      pass("T7 missing clientOpenId → invalid-argument");
    } else {
      fail("T7 wrong error", err);
    }
  }

  // T8 — invalid clientOpenId chars → invalid-argument
  try {
    await callOpen({ clientOpenId: "bad id!" });
    fail("T8 invalid clientOpenId should throw");
  } catch (err) {
    if (expectError(err, "invalid-argument")) {
      pass("T8 invalid clientOpenId chars → invalid-argument");
    } else {
      fail("T8 wrong error", err);
    }
  }

  // T9 — unauthenticated succeeds
  const t9 = await callOpen({ clientOpenId: "open-t9-unauth" });
  if (t9.data.duplicate === false) {
    pass("T9 unauthenticated callable succeeds");
  } else {
    fail("T9 unauthenticated", new Error(JSON.stringify(t9.data)));
  }

  // T10 — snapshot from seed not client (server-side counts)
  await seed(async (db) => {
    await setDoc(doc(db, "deliveries", "del-t10-extra"), {
      id: "del-t10-extra",
      jobId: JOB_ID,
      status: "partial",
      orderNumber: "ORD-T10",
      vendorId: "vendor-1",
      vendorOrderComplete: true,
      vendorPhysicalDropoffConfirmed: true,
      stagingLocationId: "",
      plannedStagingLocationIds: ["loc-g6"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(db, "items", "del-t10-extra-item-0"), {
      id: "del-t10-extra-item-0",
      deliveryOrderId: "del-t10-extra",
      description: "Fully received",
      qtyOrdered: 1,
      qtyReceived: 1,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "received",
    });
  });
  const t10ClientOpenId = "open-t10-snapshot";
  await callOpen({ clientOpenId: t10ClientOpenId });
  const t10Event = await readJobOpenEvent(t10ClientOpenId);
  if (
    t10Event?.readinessSnapshot?.deliveryCount === 4 &&
    t10Event?.readinessSnapshot?.readyForPickupCount === 3
  ) {
    pass("T10 snapshot computed from seed deliveries");
  } else {
    fail("T10 snapshot", new Error(JSON.stringify(t10Event?.readinessSnapshot)));
  }

  // T11 — existing TECH_PIN_VERIFIED unaffected
  const pinEventId = "tech-pin-existing";
  await seed(async (db) => {
    await setDoc(doc(db, "pinVerificationEvents", pinEventId), {
      id: pinEventId,
      action: "TECH_PIN_VERIFIED",
      technicianId: TECH_ID,
      technicianName: "Test Tech",
      pinVerified: true,
      timestamp: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });
  await callOpen({ clientOpenId: "open-t11-after-pin" });
  const pinEvent = await readPinEvent(pinEventId);
  if (pinEvent?.action === "TECH_PIN_VERIFIED") {
    pass("T11 existing TECH_PIN_VERIFIED unaffected");
  } else {
    fail("T11 pin event mutated", new Error(JSON.stringify(pinEvent)));
  }

  // T12 — source location_scan stored
  const t12ClientOpenId = "open-t12-source";
  await callOpen({
    clientOpenId: t12ClientOpenId,
    source: "location_scan",
  });
  const t12Event = await readJobOpenEvent(t12ClientOpenId);
  if (t12Event?.source === "location_scan") {
    pass("T12 source location_scan stored");
  } else {
    fail("T12 source", new Error(JSON.stringify(t12Event)));
  }

  // T13 — invalid source omitted, no throw
  const t13ClientOpenId = "open-t13-bad-source";
  const t13 = await callOpen({
    clientOpenId: t13ClientOpenId,
    source: "not_a_valid_source",
  });
  const t13Event = await readJobOpenEvent(t13ClientOpenId);
  if (t13.data.duplicate === false && t13Event?.source === undefined) {
    pass("T13 invalid source omitted, no throw");
  } else {
    fail("T13 invalid source", new Error(JSON.stringify({ t13: t13.data, t13Event })));
  }

  // T14 — scannedStagingLocationCode from session stored
  const t14ClientOpenId = "open-t14-staging";
  await callOpen({ clientOpenId: t14ClientOpenId });
  const t14Event = await readJobOpenEvent(t14ClientOpenId);
  if (t14Event?.scannedStagingLocationCode === "STAGE-A") {
    pass("T14 scannedStagingLocationCode from session stored");
  } else {
    fail("T14 staging code", new Error(JSON.stringify(t14Event)));
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await testEnv.cleanup();
}
