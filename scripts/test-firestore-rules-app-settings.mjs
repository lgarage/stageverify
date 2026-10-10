/**
 * Firestore rules — appSettings admin-only writes, public read.
 * Usage: npx firebase-tools emulators:exec --only firestore "node scripts/test-firestore-rules-app-settings.mjs"
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

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
  await setDoc(doc(db, "appSettings", "config"), {
    vendorSessionMinutes: 30,
  });
  await setDoc(doc(db, "dispatcherRoles", "disp-1"), {
    active: true,
    role: "dispatcher",
  });
  await setDoc(doc(db, "dispatcherRoles", "mgr-1"), {
    active: true,
    manager: true,
  });
  await setDoc(doc(db, "dispatcherRoles", "admin-1"), {
    active: true,
    role: "admin",
  });
  await setDoc(doc(db, "dispatcherRoles", "admin-inactive"), {
    active: false,
    role: "admin",
  });
  await setDoc(doc(db, "dispatcherRoles", "admin-removed"), {
    active: true,
    removed: true,
    role: "admin",
  });
});

const configRef = (db) => doc(db, "appSettings", "config");

const unauth = testEnv.unauthenticatedContext().firestore();
await assertSucceeds(getDoc(configRef(unauth)));
await assertFails(
  setDoc(configRef(unauth), { vendorSessionMinutes: 99 }),
);
await assertFails(
  updateDoc(configRef(unauth), { vendorSessionMinutes: 99 }),
);

const noRole = testEnv.authenticatedContext("no-role-user").firestore();
await assertFails(
  updateDoc(configRef(noRole), { vendorSessionMinutes: 45 }),
);

const disp = testEnv.authenticatedContext("disp-1").firestore();
await assertFails(
  updateDoc(configRef(disp), { vendorSessionMinutes: 45 }),
);

const mgr = testEnv.authenticatedContext("mgr-1").firestore();
await assertFails(
  updateDoc(configRef(mgr), { vendorSessionMinutes: 45 }),
);

const admin = testEnv.authenticatedContext("admin-1").firestore();
await assertSucceeds(
  updateDoc(configRef(admin), { vendorSessionMinutes: 45 }),
);
await assertFails(
  updateDoc(configRef(admin), { invoiceTrainingAlertEmail: "x@y.com" }),
);

const adminInactive = testEnv.authenticatedContext("admin-inactive").firestore();
await assertFails(
  updateDoc(configRef(adminInactive), { vendorSessionMinutes: 45 }),
);

const adminRemoved = testEnv.authenticatedContext("admin-removed").firestore();
await assertFails(
  updateDoc(configRef(adminRemoved), { vendorSessionMinutes: 45 }),
);

const freshRef = (db, id) => doc(db, "appSettings", id);

// unauth / no-role / dispatcher / manager cannot CREATE a new appSettings doc
await assertFails(setDoc(freshRef(unauth, "fresh-unauth"), { vendorSessionMinutes: 15 }));
await assertFails(setDoc(freshRef(noRole, "fresh-norole"), { vendorSessionMinutes: 15 }));
await assertFails(setDoc(freshRef(disp, "fresh-disp"), { vendorSessionMinutes: 15 }));
await assertFails(setDoc(freshRef(mgr, "fresh-mgr"), { vendorSessionMinutes: 15 }));

// admin can create a new doc with a normal field
await assertSucceeds(setDoc(freshRef(admin, "fresh-admin"), { vendorSessionMinutes: 15 }));

// admin cannot create with denylisted CF field
await assertFails(setDoc(freshRef(admin, "fresh-admin-deny"), { invoiceTrainingAlertEmail: "x@y.com" }));

// dispatcher setDoc merge cannot create missing config-like doc (mirrors client write)
await assertFails(
  setDoc(freshRef(disp, "config-missing"), { vendorSessionMinutes: 15 }, { merge: true }),
);

await testEnv.cleanup();
console.log("PASS: test-firestore-rules-app-settings");
