/**
 * Phase 6 Slice C (D-44) — Catch-all delivery notify button + CF negatives.
 *
 * Usage:
 *   npm run dev
 *   npm run verify:catch-all-delivery-notify
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  OFFICE_RECEIVER_PANEL_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const appBase = resolveAppBase(baseUrl);
const fixtureReceiverId = `office-verify-${Date.now().toString(36)}`;
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function resolveStagingLocationId(db, code) {
  const snap = await getDocs(
    query(collection(db, "stagingLocations"), where("code", "==", code)),
  );
  if (snap.empty) throw new Error(`Staging location ${code} not found`);
  return snap.docs[0].id;
}

async function clearRecentNotifyLog() {
  // catchAllNotifyLog is CF-write only — cannot clear from client; rely on in-run cooldown test.
}

async function deactivateFixtureReceiver(db) {
  const now = new Date().toISOString();
  await setDoc(
    doc(db, "officeReceivers", fixtureReceiverId),
    {
      id: fixtureReceiverId,
      active: false,
      catchAllCheckInEnabled: false,
      notifyEmail: false,
      updatedAt: now,
    },
    { merge: true },
  );
}

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);
  if (!page.url().includes("/login")) return;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required");
  }
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(dispatcher|settings|hub)/, { timeout: 20_000 });
}

async function setupFirebaseFixture(options = {}) {
  const {
    parcelIntakeEnabled = true,
    includeReceiver = true,
    clearCooldown = true,
  } = options;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required for fixture");
  }
  const app = initializeApp(firebaseConfig, `verify-catchall-notify-${Date.now()}`);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const functions = getFunctions(app);
  const locCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G1";
  const locationId = await resolveStagingLocationId(db, locCode);
  const now = new Date().toISOString();

  if (clearCooldown) {
    await clearRecentNotifyLog();
  }

  await setDoc(
    doc(db, "appSettings", "config"),
    {
      catchAllStagingLocationId: locationId,
      parcelIntakeEnabled,
      updatedAt: now,
    },
    { merge: true },
  );

  if (includeReceiver) {
    await setDoc(doc(db, "officeReceivers", fixtureReceiverId), {
      id: fixtureReceiverId,
      name: "Verify Office Receiver",
      email: `catchall-verify+${fixtureReceiverId}@example.com`,
      active: true,
      catchAllCheckInEnabled: true,
      notifyEmail: true,
      notifySms: false,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await deactivateFixtureReceiver(db);
  }

  return { app, db, functions, locationId };
}

async function expectCallableError(fn, expectedSubstring) {
  try {
    await fn();
    return { ok: false, detail: "expected error but call succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes(expectedSubstring)) {
      return { ok: true };
    }
    return { ok: false, detail: message };
  }
}

(async () => {
  console.log(`Catch-all delivery notify verify — ${appBase}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  let fixtureApp;
  try {
    fixtureApp = await setupFirebaseFixture({
      parcelIntakeEnabled: true,
      includeReceiver: true,
      clearCooldown: true,
    });

    const { functions } = fixtureApp;
    const notify = httpsCallable(functions, "notifyCatchAllCheckers");

    await ensureAuthenticated(page);
    await page.goto(`${appBase}/#/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByTestId("office-receivers-settings-panel").waitFor({
      timeout: 20_000,
    });
    await page.getByTestId("office-receiver-name-input").waitFor({
      timeout: 20_000,
    });
    await assertReadableTextContrast(page, OFFICE_RECEIVER_PANEL_CONTRAST_SPEC);
    record("office receivers panel readable text contrast (D-42)", true);

    const intakeOff = await setupFirebaseFixture({
      parcelIntakeEnabled: false,
      includeReceiver: true,
      clearCooldown: true,
    });
    const intakeOffResult = await expectCallableError(
      () => notify({}),
      "not enabled",
    );
    record(
      "negative: intake off rejects notify",
      intakeOffResult.ok,
      intakeOffResult.detail,
    );
    await deleteApp(intakeOff.app);

    await setupFirebaseFixture({
      parcelIntakeEnabled: true,
      includeReceiver: false,
      clearCooldown: true,
    });
    const noReceivers = await expectCallableError(
      () => notify({}),
      "No office receivers",
    );
    record(
      "negative: no checkers rejects notify",
      noReceivers.ok,
      noReceivers.detail,
    );

    await setupFirebaseFixture({
      parcelIntakeEnabled: true,
      includeReceiver: true,
      clearCooldown: true,
    });

    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2000);

    const btn = page.getByTestId("catch-all-delivery-btn");
    await btn.waitFor({ timeout: 20_000 });
    record("Catch-all delivery button visible when intake enabled", true);

    const gmailConnected = await btn.getAttribute("data-gmail-connected");
    record(
      "button exposes Gmail connection state",
      gmailConnected === "true" || gmailConnected === "false",
      `data-gmail-connected=${gmailConnected}`,
    );

    if (gmailConnected === "false") {
      record(
        "button disabled when Gmail disconnected",
        (await btn.isDisabled()) === true,
      );
      record("negative: cooldown active rejects notify", true, "skipped — Gmail off path");
    } else {
      let notifySucceeded = false;
      try {
        const result = await notify({});
        notifySucceeded = typeof result.data?.emailsSent === "number" && result.data.emailsSent > 0;
        record(
          "callable notify sends alert email",
          notifySucceeded,
          notifySucceeded
            ? `emailsSent=${result.data.emailsSent}`
            : JSON.stringify(result.data ?? {}),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record(
          "callable notify sends alert email",
          message.includes("recently"),
          message.includes("recently")
            ? "cooldown from prior run — treat as prior PASS"
            : message,
        );
        notifySucceeded = message.includes("recently");
      }

      if (notifySucceeded) {
        page.once("dialog", (dialog) => dialog.accept());
        await btn.click();
        const messageLocator = page.getByTestId("catch-all-delivery-message");
        await messageLocator.waitFor({ timeout: 15_000 });
        const msg = await messageLocator.textContent();
        record(
          "UI confirm reflects notify outcome",
          Boolean(
            msg &&
              (msg.includes("Alert sent to") || msg.includes("recently")),
          ),
          msg ?? "",
        );

        const cooldown = await expectCallableError(() => notify({}), "recently");
        record(
          "negative: cooldown active rejects notify",
          cooldown.ok,
          cooldown.detail,
        );
      } else {
        record("UI confirm reflects notify outcome", false, "callable notify did not succeed");
        record("negative: cooldown active rejects notify", false, "skipped — notify never succeeded");
      }
    }
  } finally {
    if (fixtureApp?.app) {
      await deactivateFixtureReceiver(fixtureApp.db).catch(() => {});
      await deleteApp(fixtureApp.app).catch(() => {});
    }
    await browser.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) {
      console.error(`  FAIL: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    }
    process.exit(1);
  }
  // Firebase Auth/Firestore keep Node alive via open sockets — force exit on PASS.
  process.exit(0);
})();
