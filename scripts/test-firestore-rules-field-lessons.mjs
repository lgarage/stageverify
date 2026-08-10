/**
 * Lane C C3-D.1 — Firestore rules deny-all for lessons + audit.
 * Usage: npm run test:firestore-rules-field-lessons
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

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

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "dispatcherRoles", "disp-1"), {
    active: true,
    manager: true,
    role: "manager",
  });
  await setDoc(doc(db, "vendorInvoiceFieldLessons", "lesson-1"), {
    status: "proposed",
    field: "customerPoOrReference",
  });
  await setDoc(doc(db, "vendorInvoiceFieldLessonAuditEvents", "aud-1"), {
    eventType: "proposed",
    lessonId: "lesson-1",
  });
});

const unauth = testEnv.unauthenticatedContext().firestore();
await assertFails(getDoc(doc(unauth, "vendorInvoiceFieldLessons", "lesson-1")));
await assertFails(
  setDoc(doc(unauth, "vendorInvoiceFieldLessons", "hack"), { x: 1 }),
);
await assertFails(
  getDoc(doc(unauth, "vendorInvoiceFieldLessonAuditEvents", "aud-1")),
);

const randomUser = testEnv.authenticatedContext("user-x").firestore();
await assertFails(
  getDoc(doc(randomUser, "vendorInvoiceFieldLessons", "lesson-1")),
);
await assertFails(
  setDoc(doc(randomUser, "vendorInvoiceFieldLessons", "hack2"), { x: 1 }),
);

const dispatcher = testEnv.authenticatedContext("disp-1").firestore();
await assertFails(
  getDoc(doc(dispatcher, "vendorInvoiceFieldLessons", "lesson-1")),
);
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceFieldLessons", "hack3"), {
    status: "active",
  }),
);
await assertFails(
  getDoc(doc(dispatcher, "vendorInvoiceFieldLessonAuditEvents", "aud-1")),
);
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceFieldLessonAuditEvents", "hack-aud"), {
    eventType: "proposed",
  }),
);

await testEnv.cleanup();
console.log("PASS: test-firestore-rules-field-lessons");
