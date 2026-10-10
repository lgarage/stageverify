/**
 * Firestore rules — appSettings public read, staff operational writes, admin risky writes.
 * Usage: npm run test:firestore-rules-app-settings
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

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
  await setDoc(doc(db, "dispatcherRoles", "disp-inactive"), {
    active: false,
    role: "dispatcher",
  });
  await setDoc(doc(db, "dispatcherRoles", "disp-removed"), {
    active: true,
    removed: true,
    role: "dispatcher",
  });
  await setDoc(doc(db, "dispatcherRoles", "mgr-1"), {
    active: true,
    manager: true,
  });
  await setDoc(doc(db, "dispatcherRoles", "legacy-staff-1"), {
    active: true,
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
const freshRef = (db, id) => doc(db, "appSettings", id);
const roleRef = (db, uid) => doc(db, "dispatcherRoles", uid);

const unauth = testEnv.unauthenticatedContext().firestore();
await assertSucceeds(getDoc(configRef(unauth)));
await assertFails(setDoc(configRef(unauth), { vendorSessionMinutes: 99 }));
await assertFails(updateDoc(configRef(unauth), { vendorSessionMinutes: 99 }));

const vendorPin = testEnv.authenticatedContext("vendor-pin-user").firestore();
await assertFails(updateDoc(configRef(vendorPin), { vendorSessionMinutes: 40 }));

const techPin = testEnv.authenticatedContext("tech-pin-user").firestore();
await assertFails(updateDoc(configRef(techPin), { vendorSessionMinutes: 41 }));

const noRole = testEnv.authenticatedContext("no-role-user").firestore();
await assertFails(updateDoc(configRef(noRole), { vendorSessionMinutes: 45 }));

const disp = testEnv.authenticatedContext("disp-1").firestore();
await assertSucceeds(
  updateDoc(configRef(disp), { vendorSessionMinutes: 45 }),
);
await assertFails(
  updateDoc(configRef(disp), { monitoringInboxEmail: "ops@example.com" }),
);
await assertFails(
  updateDoc(configRef(disp), { catchAllPendingCheckInCount: 1 }),
);
await assertFails(
  updateDoc(configRef(disp), {
    vendorSessionMinutes: 46,
    emailMonitoringEnabled: true,
  }),
);

const mgr = testEnv.authenticatedContext("mgr-1").firestore();
await assertSucceeds(
  updateDoc(configRef(mgr), { autoSubmitMinutes: 12 }),
);
await assertFails(
  updateDoc(configRef(mgr), { invoiceAiShadowEnabled: true }),
);

const legacyStaff = testEnv.authenticatedContext("legacy-staff-1").firestore();
await assertSucceeds(
  updateDoc(configRef(legacyStaff), {
    vendorDeliveryMode: "full_checkin",
  }),
);

const admin = testEnv.authenticatedContext("admin-1").firestore();
await assertSucceeds(
  updateDoc(configRef(admin), {
    vendorSessionMinutes: 50,
    emailReplyIngestEnabled: true,
  }),
);
await assertFails(
  updateDoc(configRef(admin), { managementPinHash: "deadbeef" }),
);

const adminInactive = testEnv.authenticatedContext("admin-inactive").firestore();
await assertFails(
  updateDoc(configRef(adminInactive), { vendorSessionMinutes: 45 }),
);

const adminRemoved = testEnv.authenticatedContext("admin-removed").firestore();
await assertFails(
  updateDoc(configRef(adminRemoved), { vendorSessionMinutes: 45 }),
);

const dispInactive = testEnv.authenticatedContext("disp-inactive").firestore();
await assertFails(
  updateDoc(configRef(dispInactive), { vendorSessionMinutes: 45 }),
);

const dispRemoved = testEnv.authenticatedContext("disp-removed").firestore();
await assertFails(
  updateDoc(configRef(dispRemoved), { vendorSessionMinutes: 45 }),
);

await assertFails(
  setDoc(roleRef(disp, "disp-1"), { active: true, role: "admin" }),
);
await assertFails(
  updateDoc(roleRef(disp, "disp-1"), { role: "admin" }),
);

await assertSucceeds(
  updateDoc(configRef(disp), { shopMapLayoutExtras: { a: 1 } }),
);
await assertSucceeds(
  updateDoc(configRef(disp), { catchAllStagingLocationId: "spot-1" }),
);
await assertSucceeds(
  updateDoc(configRef(disp), { parcelIntakeEnabled: true }),
);

await assertSucceeds(
  updateDoc(configRef(admin), { monitoringInboxEmail: "admin@example.com" }),
);

await assertFails(
  updateDoc(configRef(disp), { notARealField: "x" }),
);
await assertFails(
  updateDoc(configRef(admin), { notARealField: "x" }),
);
await assertFails(
  setDoc(configRef(disp), { notARealField: "x" }, { merge: true }),
);
await assertFails(
  setDoc(configRef(admin), { notARealField: "x" }, { merge: true }),
);

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(
    configRef(db),
    { monitoringInboxEmail: "seed@example.com", vendorSessionMinutes: 30 },
    { merge: true },
  );
});
await assertFails(
  setDoc(configRef(disp), { vendorSessionMinutes: 1 }),
);
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(
    configRef(db),
    {
      catchAllPendingCheckInCount: 3,
      vendorSessionMinutes: 30,
      monitoringInboxEmail: "seed@example.com",
    },
    { merge: true },
  );
});
await assertFails(
  setDoc(configRef(admin), {
    vendorSessionMinutes: 30,
    monitoringInboxEmail: "seed@example.com",
    emailMonitoringEnabled: true,
  }),
);

await assertFails(
  updateDoc(configRef(disp), { monitoringInboxEmail: deleteField() }),
);
await assertSucceeds(
  updateDoc(configRef(admin), { monitoringInboxEmail: deleteField() }),
);
await assertFails(
  updateDoc(configRef(admin), {
    catchAllPendingCheckInCount: deleteField(),
  }),
);

await assertFails(deleteDoc(configRef(admin)));

// --- create paths (non-config doc ids must fail) ---
await assertFails(
  setDoc(freshRef(unauth, "fresh-unauth"), { vendorSessionMinutes: 15 }),
);
await assertFails(
  setDoc(freshRef(noRole, "fresh-norole"), { vendorSessionMinutes: 15 }),
);

await assertFails(
  setDoc(freshRef(disp, "fresh-disp"), { vendorSessionMinutes: 15 }),
);
await assertFails(
  setDoc(freshRef(disp, "fresh-disp-risky"), {
    monitoringInboxEmail: "a@b.com",
  }),
);
await assertFails(
  setDoc(
    freshRef(disp, "fresh-disp-merge"),
    { parcelIntakeEnabled: true },
    { merge: true },
  ),
);

await assertFails(
  setDoc(freshRef(mgr, "fresh-mgr"), { technicianSessionMinutes: 20 }),
);
await assertFails(
  setDoc(freshRef(admin, "fresh-admin"), { managementSessionMinutes: 25 }),
);

await assertFails(
  setDoc(freshRef(admin, "fresh-admin-risky"), {
    vendorSessionMinutes: 15,
    emailMonitoringEnabled: true,
  }),
);
await assertFails(
  setDoc(freshRef(admin, "fresh-admin-cf"), {
    invoiceTrainingAlertEmail: "x@y.com",
  }),
);
await assertFails(
  setDoc(freshRef(admin, "other"), { vendorSessionMinutes: 15 }),
);

// --- create-on-missing-config (last — deletes config) ---
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await deleteDoc(configRef(db));
});

await assertFails(setDoc(configRef(disp), { notARealField: "x" }));
await assertFails(setDoc(configRef(admin), { notARealField: "x" }));

await assertFails(
  setDoc(configRef(unauth), { vendorSessionMinutes: 20 }),
);
await assertSucceeds(
  setDoc(configRef(disp), { vendorSessionMinutes: 20 }),
);

await testEnv.cleanup();
console.log("PASS: test-firestore-rules-app-settings");
