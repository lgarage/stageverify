/**
 * Playwright: Catch-all count updates when a seed delivery is assigned
 * into / out of CA (local Vite only — prod occupancy hides seed demos).
 *
 * Restores the fixture in finally. Does not Confirm Change Location / CF.
 * Uses the same plannedStagingLocationIds field the map occupancy helper reads.
 *
 *   npm run dev
 *   node scripts/verify-catch-all-count-move.mjs
 */
import { chromium } from "playwright";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";

const FIXTURE_ID = "delivery-2";
const baseUrl =
  process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
loadEnvLocal();

if (/lgarage\.github\.io/i.test(appBase)) {
  throw new Error(
    "Refusing to run seed movement against production Pages — Vite-only (seeds are hidden in PROD).",
  );
}

async function withAuthedDb(fn) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
  }
  const app = initializeApp(
    {
      apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
      authDomain: "stageverify-db.firebaseapp.com",
      projectId: "stageverify-db",
      storageBucket: "stageverify-db.firebasestorage.app",
      messagingSenderId: "784751243681",
      appId: "1:784751243681:web:31fa71762b94f878fd1be0",
    },
    `verify-ca-count-move-${Date.now()}`,
  );
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  return fn(getFirestore(app));
}

function requireNumeric(label, text) {
  const trimmed = String(text ?? "").trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} is not a numeric count: "${trimmed}"`);
  }
  return Number(trimmed);
}

async function readCounts(page) {
  const mapText = await page.getByTestId("catch-all-pending-count").first().innerText();
  const badgeText = await page.getByTestId("catch-all-delivery-count-badge").innerText();
  const map = requireNumeric("CA map count", mapText);
  const badge = requireNumeric("top-bar Catch-all badge", badgeText);
  if (badge !== map) {
    throw new Error(`Top-bar badge ${badge} !== CA map count ${map}`);
  }
  return { badge, map };
}

async function waitForCount(page, expected) {
  await page.waitForFunction(
    (want) => {
      const map = document.querySelector('[data-testid="catch-all-pending-count"]');
      const badge = document.querySelector('[data-testid="catch-all-delivery-count-badge"]');
      return (
        map &&
        badge &&
        map.textContent?.trim() === String(want) &&
        badge.textContent?.trim() === String(want)
      );
    },
    expected,
    { timeout: 20_000 },
  );
  return readCounts(page);
}

async function openZones(page) {
  await page.goto(`${appBase}/#/zones`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30_000,
  });
  await page
    .getByText("Loading zones…")
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {});
  await page.getByTestId("catch-all-pending-count").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByTestId("catch-all-delivery-count-badge").waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let restore = null;

try {
  const meta = await withAuthedDb(async (db) => {
    const settingsSnap = await getDoc(doc(db, "appSettings", "config"));
    const catchAllId = String(
      settingsSnap.data()?.catchAllStagingLocationId ?? "",
    ).trim();
    if (!catchAllId) {
      throw new Error("appSettings.catchAllStagingLocationId is empty");
    }
    const fixtureRef = doc(db, "deliveries", FIXTURE_ID);
    const fixtureSnap = await getDoc(fixtureRef);
    if (!fixtureSnap.exists()) {
      throw new Error(`Missing fixture ${FIXTURE_ID}`);
    }
    const data = fixtureSnap.data();
    restore = {
      stagingLocationId: data.stagingLocationId ?? null,
      additionalStagingLocationIds: data.additionalStagingLocationIds ?? null,
      plannedStagingLocationIds: data.plannedStagingLocationIds ?? null,
      invoiceFulfillmentMethod: data.invoiceFulfillmentMethod ?? null,
      invoiceImportStatus: data.invoiceImportStatus ?? null,
    };
    return { db, catchAllId, fixtureRef };
  });

  await ensureAuthenticated(page, appBase);
  await openZones(page);
  const before = await readCounts(page);

  await withAuthedDb(async (db) => {
    await updateDoc(doc(db, "deliveries", FIXTURE_ID), {
      invoiceFulfillmentMethod: "delivery",
      invoiceImportStatus: "pending",
      stagingLocationId: deleteField(),
      additionalStagingLocationIds: deleteField(),
      plannedStagingLocationIds: [meta.catchAllId],
      updatedAt: new Date().toISOString(),
    });
  });

  const afterIn = await waitForCount(page, before.badge + 1);
  if (afterIn.badge !== before.badge + 1) {
    throw new Error(
      `After assign into CA: expected ${before.badge + 1}, got ${afterIn.badge}`,
    );
  }

  await withAuthedDb(async (db) => {
    await updateDoc(doc(db, "deliveries", FIXTURE_ID), {
      invoiceFulfillmentMethod: restore.invoiceFulfillmentMethod ?? "delivery",
      invoiceImportStatus: restore.invoiceImportStatus ?? "pending",
      stagingLocationId: restore.stagingLocationId
        ? restore.stagingLocationId
        : deleteField(),
      additionalStagingLocationIds: Array.isArray(
        restore.additionalStagingLocationIds,
      )
        ? restore.additionalStagingLocationIds
        : deleteField(),
      plannedStagingLocationIds: Array.isArray(restore.plannedStagingLocationIds)
        ? restore.plannedStagingLocationIds
        : deleteField(),
      updatedAt: new Date().toISOString(),
    });
  });

  const afterOut = await waitForCount(page, before.badge);
  console.log(
    `PASS: verify-catch-all-count-move — before=${before.badge} in=${afterIn.badge} out=${afterOut.badge}`,
  );
} catch (err) {
  console.error("FAIL:", err);
  try {
    if (restore) {
      await withAuthedDb(async (db) => {
        await updateDoc(doc(db, "deliveries", FIXTURE_ID), {
          invoiceFulfillmentMethod: restore.invoiceFulfillmentMethod ?? "delivery",
          invoiceImportStatus: restore.invoiceImportStatus ?? "pending",
          stagingLocationId: restore.stagingLocationId
            ? restore.stagingLocationId
            : deleteField(),
          additionalStagingLocationIds: Array.isArray(
            restore.additionalStagingLocationIds,
          )
            ? restore.additionalStagingLocationIds
            : deleteField(),
          plannedStagingLocationIds: Array.isArray(
            restore.plannedStagingLocationIds,
          )
            ? restore.plannedStagingLocationIds
            : deleteField(),
          updatedAt: new Date().toISOString(),
        });
      });
    }
  } catch (restoreErr) {
    console.error("RESTORE FAIL:", restoreErr);
  }
  process.exit(1);
} finally {
  await browser.close();
}
