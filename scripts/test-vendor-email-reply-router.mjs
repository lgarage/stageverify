/**
 * Emulator tests for inbound reply router + sendVendorEmail auth (Stage 1).
 * Usage: npm run test:vendor-email-reply-router
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { decodeGmailBodyData } from "../functions/src/gmailInbound.ts";
import { generateTrackingToken, subjectWithTrackingTag } from "../functions/src/email/trackingToken.ts";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");
const { processInboundGmailMessage } = require("../functions/lib/inboundEmail/processInboundGmailMessage.js");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "stageverify-db" });
}

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const DISPATCHER_EMAIL = "reply-router-dispatcher@test.local";
const NON_DISPATCHER_EMAIL = "reply-router-user@test.local";
const PASSWORD = "StageVerifyTest1!";
const TOKEN = generateTrackingToken();
const THREAD_ID = "thread-reply-test-1";

let passed = 0;
let failed = 0;

function pass(msg) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, detail) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (detail) console.error(`    ${detail}`);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync(RULES_PATH, "utf8") },
});

const clientApp = initializeApp(firebaseConfig, "reply-router-client");
const db = getFirestore(clientApp);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

async function seedBase(dispatcherUid) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, "dispatcherRoles", dispatcherUid), {
      active: true,
      updatedAt: "2026-07-06T00:00:00Z",
    });
    await setDoc(doc(adminDb, "appSettings", "config"), {
      emailReplyIngestEnabled: true,
      emailReplyIngestSince: "2026-01-01T00:00:00Z",
    });
    await setDoc(doc(adminDb, "vendors", "vendor-1"), {
      id: "vendor-1",
      name: "Johnstone",
      email: "rep@johnstone.com",
    });
    await setDoc(doc(adminDb, "deliveries", "del-1"), {
      id: "del-1",
      orderNumber: "ORD-1001",
      vendorId: "vendor-1",
      jobId: "job-1",
      status: "arrived",
      updatedAt: "2026-07-06T00:00:00Z",
    });
    await setDoc(doc(adminDb, "vendorEmailEvents", "vee-outbound-seed"), {
      id: "vee-outbound-seed",
      direction: "outbound",
      sourceMessageId: "gmail-out-seed",
      threadId: THREAD_ID,
      rfc822MessageId: "<out-seed@svbotmail>",
      trackingToken: TOKEN,
      deliveryOrderId: "del-1",
      vendorId: "vendor-1",
      subject: subjectWithTrackingTag("PO status", TOKEN),
      senderEmail: "svbotmail@gmail.com",
      recipientEmails: ["rep@johnstone.com"],
      reviewStatus: "approved",
      receivedAt: "2026-07-06T10:00:00Z",
      createdAt: "2026-07-06T10:00:00Z",
      updatedAt: "2026-07-06T10:00:00Z",
    });
  });
}

function buildReplyFixture(gmailMessageId, overrides = {}) {
  const bodyText = overrides.bodyText ?? "All items shipped for PO 411190.";
  const bodyData = Buffer.from(bodyText, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const headers = [
    { name: "From", value: overrides.from ?? "rep@johnstone.com" },
    { name: "To", value: "svbotmail@gmail.com" },
    { name: "Subject", value: overrides.subject ?? "Re: status" },
    { name: "Date", value: "Sun, 6 Jul 2026 11:00:00 +0000" },
    { name: "Message-ID", value: `<${gmailMessageId}@reply.test>` },
    { name: "In-Reply-To", value: "<out-seed@svbotmail>" },
  ];
  if (overrides.authenticationResults) {
    headers.push({
      name: "Authentication-Results",
      value: overrides.authenticationResults,
    });
  }
  return {
    id: gmailMessageId,
    threadId: THREAD_ID,
    internalDate: String(Date.parse("2026-07-06T11:00:00Z")),
    snippet: bodyText.slice(0, 80),
    payload: {
      headers,
      mimeType: "text/plain",
      body: { data: bodyData, size: bodyText.length },
    },
  };
}

console.log("\n=== test-vendor-email-reply-router ===\n");

let dispatcherUid;
try {
  const cred = await createUserWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);
  dispatcherUid = cred.user.uid;
} catch {
  await signInWithEmailAndPassword(auth, DISPATCHER_EMAIL, PASSWORD);
  dispatcherUid = auth.currentUser.uid;
}

try {
  await createUserWithEmailAndPassword(auth, NON_DISPATCHER_EMAIL, PASSWORD);
} catch {
  // exists
}

await seedBase(dispatcherUid);

console.log("1. sendVendorEmail rejects non-dispatcher");
await signInWithEmailAndPassword(auth, NON_DISPATCHER_EMAIL, PASSWORD);
const sendVendorEmail = httpsCallable(functions, "sendVendorEmail");
try {
  await sendVendorEmail({
    deliveryOrderId: "del-1",
    to: "rep@johnstone.com",
    subject: "Test",
    body: "Hello",
  });
  fail("non-dispatcher should be rejected");
} catch (err) {
  const msg = String(err?.message ?? "");
  if (msg.includes("Dispatcher role") || msg.includes("permission-denied")) {
    pass("non-dispatcher rejected");
  } else {
    fail("unexpected non-dispatcher error", msg);
  }
}

console.log("\n2. reply router routes no-PDF when flag on");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  const msgId = "gmail-reply-fixture-1";
  const result = await processInboundGmailMessage("fake-token", msgId, {
    prefetchedMessage: buildReplyFixture(msgId),
  });
  if (result.processingStatus === "reply_processed" && result.vendorEmailEventId) {
    pass("processingStatus reply_processed");
    const eventSnap = await getDoc(
      doc(adminDb, "vendorEmailEvents", result.vendorEmailEventId),
    );
    const event = eventSnap.data();
    if (event?.direction === "inbound" && event?.matchedBy === "threadId") {
      pass("inbound event threadId match");
    } else {
      fail("event match fields", JSON.stringify(event));
    }
    if (event?.deliveryOrderId === "del-1") {
      pass("linked to outbound delivery");
    } else {
      fail("delivery link missing");
    }
    if (event?.humanReviewRequired !== true) {
      pass("trusted thread match not forced to review");
    } else {
      fail("unexpected humanReviewRequired on clean thread match");
    }
    const deliverySnap = await getDoc(doc(adminDb, "deliveries", "del-1"));
    if (deliverySnap.data()?.vendorOrderComplete !== true) {
      pass("delivery status not mutated");
    } else {
      fail("delivery was mutated by reply ingest");
    }
  } else {
    fail("reply not processed", JSON.stringify(result));
  }

  console.log("\n3. duplicate reply deduped");
  const dup = await processInboundGmailMessage("fake-token", msgId, {
    prefetchedMessage: buildReplyFixture(msgId),
  });
  if (dup.skipped) {
    pass("duplicate gmail message skipped");
  } else {
    fail("duplicate should skip");
  }
  const eventsSnap = await getDocs(
    query(collection(adminDb, "vendorEmailEvents"), where("sourceMessageId", "==", msgId)),
  );
  if (eventsSnap.size === 1) {
    pass("exactly one vendorEmailEvent for message");
  } else {
    fail(`expected 1 event, got ${eventsSnap.size}`);
  }
});

console.log("\n4. spoof ingest — known vendor + forged Ref + failed SPF");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(
    doc(adminDb, "appSettings", "config"),
    { emailReplyIngestEnabled: true },
    { merge: true },
  );
  const msgId = "gmail-spoof-forged-ref";
  const forgedToken = generateTrackingToken();
  const result = await processInboundGmailMessage("fake-token", msgId, {
    prefetchedMessage: buildReplyFixture(msgId, {
      bodyText: `Ref: SV-${forgedToken}\n\nShipped PO 411190.`,
      authenticationResults: "spf=fail dkim=none",
    }),
  });
  if (result.processingStatus === "reply_processed" && result.vendorEmailEventId) {
    pass("spoof reply still ingested as review-only event");
    const eventSnap = await getDoc(
      doc(adminDb, "vendorEmailEvents", result.vendorEmailEventId),
    );
    const event = eventSnap.data();
    if (event?.matchedBy === "threadId" && event?.humanReviewRequired === true) {
      pass("thread match flagged humanReviewRequired");
    } else {
      fail("spoof match fields", JSON.stringify(event));
    }
    if (
      event?.applyConflictReason?.includes("spoofed_body_ref_failed_auth") ||
      event?.applyConflictReason?.includes("non_canonical_body_ref")
    ) {
      pass("spoof conflict reason recorded");
    } else {
      fail("missing spoof conflict reason", event?.applyConflictReason);
    }
    const deliverySnap = await getDoc(doc(adminDb, "deliveries", "del-1"));
    if (deliverySnap.data()?.vendorOrderComplete !== true) {
      pass("spoof reply did not mutate delivery");
    } else {
      fail("delivery mutated by spoof reply");
    }
    const shellSnap = await getDocs(collection(adminDb, "deliveries"));
    const shellCount = shellSnap.docs.filter((d) => d.id.startsWith("delivery-vii-")).length;
    if (shellCount === 0) {
      pass("spoof reply did not create delivery shell");
    } else {
      fail("unexpected delivery shells from spoof reply");
    }
  } else {
    fail("spoof reply not processed", JSON.stringify(result));
  }
});

console.log("\n5. flag off keeps no_pdf");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(
    doc(adminDb, "appSettings", "config"),
    { emailReplyIngestEnabled: false },
    { merge: true },
  );
  const msgId = "gmail-no-pdf-flag-off";
  const result = await processInboundGmailMessage("fake-token", msgId, {
    prefetchedMessage: buildReplyFixture(msgId),
  });
  if (result.processingStatus === "no_pdf" && !result.vendorEmailEventId) {
    pass("flag off → no_pdf unchanged");
  } else {
    fail("flag off behavior wrong", JSON.stringify(result));
  }
});

console.log("\n6. decodeGmailBodyText sanity");
const sampleBody = decodeGmailBodyData(
  Buffer.from("Hello vendor reply", "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_"),
);
if (sampleBody === "Hello vendor reply") {
  pass("body decode works");
} else {
  fail("body decode failed");
}

console.log(`\n${passed} passed, ${failed} failed`);
await testEnv.cleanup();
process.exit(failed > 0 ? 1 : 0);
