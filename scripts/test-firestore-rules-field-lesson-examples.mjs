/**
 * Lane C C3-C.1 — Firestore rules for vendorInvoiceFieldLessonExamples (deny-all).
 * Usage: npm run test:firestore-rules-field-lesson-examples
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
  await setDoc(doc(db, "vendorInvoiceFieldLessonExamples", "ex-1"), {
    id: "ex-1",
    sourceDocumentKey: "imp-1",
    field: "customerPoOrReference",
    correctedValue: "2205 EARLY",
    evidenceType: "document_evidence",
  });
});

const unauth = testEnv.unauthenticatedContext().firestore();
await assertFails(getDoc(doc(unauth, "vendorInvoiceFieldLessonExamples", "ex-1")));
await assertFails(
  setDoc(doc(unauth, "vendorInvoiceFieldLessonExamples", "hack"), { x: 1 }),
);

const randomUser = testEnv.authenticatedContext("user-x").firestore();
await assertFails(
  getDoc(doc(randomUser, "vendorInvoiceFieldLessonExamples", "ex-1")),
);
await assertFails(
  setDoc(doc(randomUser, "vendorInvoiceFieldLessonExamples", "hack2"), { x: 1 }),
);

const dispatcher = testEnv.authenticatedContext("disp-1").firestore();
await assertFails(
  getDoc(doc(dispatcher, "vendorInvoiceFieldLessonExamples", "ex-1")),
);
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceFieldLessonExamples", "hack3"), {
    field: "customerPoOrReference",
    correctedValue: "EVIL",
  }),
);

await testEnv.cleanup();
console.log("PASS: test-firestore-rules-field-lesson-examples");
