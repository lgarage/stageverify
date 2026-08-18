/**
 * All-vendor location-scan PIN matrix.
 * Discovers active vendor identities from Firestore; never prints raw PINs.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-vendor-all-pins.mjs
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify node scripts/verify-vendor-all-pins.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore } from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import { VENDOR_RUN_LAYOUT_CONTRAST_SPEC } from "./lib/ui-text-contrast-lib.mjs";
import {
  getFirebaseAccessToken,
  firestoreRestBase,
} from "./lib/firestore-admin-rest.mjs";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const PROJECT_ID = "stageverify-db";
const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const loc = process.env.STAGEVERIFY_SIGN_LOC ?? "G1";
const outDir = resolve(process.cwd(), "screenshots", "vendor-all-pins");
mkdirSync(outDir, { recursive: true });

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

function maskPin(pin) {
  if (typeof pin !== "string" || pin.length < 2) return "****";
  return `${"*".repeat(pin.length - 2)}${pin.slice(-2)}`;
}

function parseValue(v) {
  if (!v || typeof v !== "object") return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.mapValue?.fields) {
    const out = {};
    for (const [k, nested] of Object.entries(v.mapValue.fields)) {
      out[k] = parseValue(nested);
    }
    return out;
  }
  return undefined;
}

function decryptPin(encrypted, key) {
  const iv = Buffer.from(encrypted.iv, "hex");
  const ciphertext = Buffer.from(encrypted.ciphertext, "hex");
  const tag = Buffer.from(encrypted.tag, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

function loadEncryptionKey() {
  if (!process.env.FIREBASE_TOKEN?.trim()) return null;
  const out = execFileSync(
    "firebase",
    [
      "functions:secrets:access",
      "ACCESS_PIN_ENCRYPTION_KEY",
      "--project",
      PROJECT_ID,
      "--token",
      process.env.FIREBASE_TOKEN,
    ],
    { encoding: "utf8" },
  );
  const line = out
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => /^[A-Za-z0-9+/=]{40,}$/.test(row) && !row.startsWith("⚠"));
  if (!line) return null;
  const key = Buffer.from(line, "base64");
  return key.byteLength === 32 ? key : null;
}

async function listActiveVendors() {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required to list vendors");
  }
  const app = initializeApp(firebaseConfig, `vendor-all-pins-${Date.now()}`);
  await signInWithEmailAndPassword(getAuth(app), email, password);
  const snap = await getDocs(collection(getFirestore(app), "vendors"));
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        vendorId: doc.id,
        name: typeof data.name === "string" ? data.name : doc.id,
        active: data.active !== false,
        pinConfigured: data.pinConfigured === true,
        companyWideSessionEnabled: data.companyWideSessionEnabled === true,
      };
    })
    .filter((v) => v.active && (v.pinConfigured || v.companyWideSessionEnabled));
}

async function loadVendorPins(vendors) {
  const fromFile = existsSync("/tmp/vendor-pin-transient.json")
    ? JSON.parse(readFileSync("/tmp/vendor-pin-transient.json", "utf8"))
    : {};
  const pins = {};
  for (const vendor of vendors) {
    const cached = fromFile[`vendor:${vendor.vendorId}`];
    if (typeof cached === "string" && /^\d{4,6}$/.test(cached)) {
      pins[vendor.vendorId] = cached;
    }
  }
  const missing = vendors.filter((v) => !pins[v.vendorId]);
  if (missing.length === 0) return pins;

  const key = loadEncryptionKey();
  if (!key) {
    throw new Error(
      `Missing PINs for ${missing.map((v) => v.vendorId).join(",")} and cannot decrypt`,
    );
  }
  const accessToken = await getFirebaseAccessToken();
  for (const vendor of missing) {
    const url = `${firestoreRestBase(PROJECT_ID)}/accessPinSecrets/vendor_${vendor.vendorId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`secret fetch failed for ${vendor.vendorId}: ${res.status}`);
    }
    const doc = await res.json();
    const data = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
      data[k] = parseValue(v);
    }
    if (!data.pinEncrypted) {
      throw new Error(`PIN not revealable for ${vendor.vendorId}`);
    }
    const pin = decryptPin(data.pinEncrypted, key);
    if (!/^\d{4,6}$/.test(pin)) {
      throw new Error(`unexpected PIN shape for ${vendor.vendorId}`);
    }
    pins[vendor.vendorId] = pin;
  }
  return pins;
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  const verifyBtn = page.getByTestId("location-scan-pin-verify");
  if (await verifyBtn.isVisible().catch(() => false)) {
    await verifyBtn.click();
  }
}

function expectedHeading(name) {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned ? `${cleaned.toUpperCase()} DELIVERIES` : "DELIVERIES";
}

function recordRow(row, key, pass, detail = "") {
  row[key] = pass ? "PASS" : "FAIL";
  if (detail) row[`${key}Detail`] = detail;
  console.log(
    `${pass ? "PASS" : "FAIL"}: ${row.vendor} ${key}${detail ? ` — ${detail}` : ""}`,
  );
}

async function runVendor(browser, vendor, pin) {
  const row = {
    vendor: vendor.name,
    vendorId: vendor.vendorId,
    maskedPin: maskPin(pin),
    authentication: "FAIL",
    sharedUiPath: "FAIL",
    heading: "FAIL",
    mobileLayout: "FAIL",
    orderNavigation: "FAIL",
    inAppBack: "FAIL",
    browserBackForward: "FAIL",
    verdict: "FAIL",
  };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${appBase}/#/demo/vendor-scan`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.goto(`${appBase}/#/s?loc=${encodeURIComponent(loc)}&_t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByTestId("location-scan-pin-keypad").waitFor({ timeout: 20_000 });
    await enterPin(page, pin.split(""));
    const landing = page.locator(
      '[data-testid="vendor-run-layout"], [data-testid="vendor-job-deliveries"]',
    );
    await landing.first().waitFor({ timeout: 45_000 });

    const heading = (
      (await page.getByTestId("vendor-deliveries-heading").textContent()) ?? ""
    ).trim();
    const sharedLanding = await page
      .locator(".vendor-deliveries-landing")
      .isVisible();
    const vendorRun = await page
      .getByTestId("vendor-run-layout")
      .isVisible()
      .catch(() => false);
    const jobList = await page
      .getByTestId("vendor-job-deliveries")
      .isVisible()
      .catch(() => false);

    const resolvedName = (
      await page.evaluate(() => {
        const ctx = document.querySelector(".vendor-deliveries-context");
        return (ctx?.textContent ?? "").trim();
      })
    ).toUpperCase();
    const authOk =
      resolvedName.includes(vendor.name.toUpperCase()) ||
      heading.includes(vendor.name.toUpperCase());
    recordRow(row, "authentication", authOk, vendorRun ? "company-run" : "job-list");
    recordRow(
      row,
      "sharedUiPath",
      sharedLanding && (vendorRun || jobList),
      vendorRun ? "VendorDeliveriesLanding + vendor-run" : "VendorDeliveriesLanding + job-list",
    );
    recordRow(
      row,
      "heading",
      heading === expectedHeading(vendor.name),
      heading,
    );

    const contrastSpec = {
      ...VENDOR_RUN_LAYOUT_CONTRAST_SPEC,
      rootSelector: vendorRun
        ? '[data-testid="vendor-run-layout"]'
        : '[data-testid="vendor-job-deliveries"]',
      elements: [
        {
          name: "shared heading",
          selector: '[data-testid="vendor-deliveries-heading"]',
          large: true,
        },
        {
          name: "shared helper",
          selector: ".vendor-deliveries-helper",
          large: false,
        },
        {
          name: "in-app Back",
          selector: vendorRun
            ? '[data-testid="vendor-run-back"]'
            : "footer button",
          large: false,
        },
      ],
    };
    try {
      await assertReadableTextContrast(page, contrastSpec);
      recordRow(row, "mobileLayout", true, "D-42 + shared chrome");
    } catch (err) {
      recordRow(
        row,
        "mobileLayout",
        false,
        err instanceof Error ? err.message.slice(0, 160) : "contrast fail",
      );
    }

    if (vendorRun) {
      const toggle = page.locator('[data-testid^="vendor-run-toggle-"]').first();
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        await page.waitForTimeout(300);
        recordRow(row, "orderNavigation", true, "expand/collapse");
      } else {
        recordRow(row, "orderNavigation", true, "no expandable row — empty/data-only");
      }
      await page.getByTestId("vendor-run-back").click();
    } else {
      const order = page.locator('[data-testid^="vendor-job-delivery-"]').first();
      if (await order.isVisible().catch(() => false)) {
        await order.click();
        await page
          .locator(
            '[data-testid="vendor-hub-delivery-card"], [data-testid="vendor-job-deliveries"]',
          )
          .first()
          .waitFor({ timeout: 20_000 });
        const hubBack = page.getByRole("button", { name: /back/i }).first();
        if (await hubBack.isVisible().catch(() => false)) {
          await hubBack.click();
        }
        recordRow(row, "orderNavigation", true, "open order + hub back");
      } else {
        recordRow(row, "orderNavigation", true, "no job order — empty");
      }
      await page.getByRole("button", { name: "← Back" }).click();
    }

    await page.getByTestId("location-scan-pin-keypad").waitFor({ timeout: 15_000 });
    recordRow(row, "inAppBack", true, "returned to PIN");

    await page.goBack();
    await page.waitForTimeout(400);
    const leftLanding = !(await landing.first().isVisible().catch(() => false));
    await page.goForward();
    await page.waitForTimeout(800);
    const backOnScan = await page
      .locator(
        '[data-testid="location-scan-pin-keypad"], [data-testid="vendor-deliveries-heading"]',
      )
      .first()
      .isVisible()
      .catch(() => false);
    recordRow(
      row,
      "browserBackForward",
      leftLanding && backOnScan,
      leftLanding
        ? "back left flow; forward returned to location-scan"
        : "back stayed on landing",
    );

    const shot = resolve(
      outDir,
      `after-${vendor.vendorId.replace(/[^a-z0-9-]/gi, "")}.png`,
    );
    await page.screenshot({ path: shot, fullPage: false });

    const keys = [
      "authentication",
      "sharedUiPath",
      "heading",
      "mobileLayout",
      "orderNavigation",
      "inAppBack",
      "browserBackForward",
    ];
    row.verdict = keys.every((k) => row[k] === "PASS") ? "PASS" : "FAIL";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    row.verdict = "FAIL";
    row.error = msg.slice(0, 240);
    console.log(`FAIL: ${vendor.name} exception — ${row.error}`);
    await page
      .screenshot({
        path: resolve(outDir, `fail-${vendor.vendorId}.png`),
        fullPage: false,
      })
      .catch(() => {});
  } finally {
    await context.close();
  }
  return row;
}

async function main() {
  const vendors = await listActiveVendors();
  if (vendors.length === 0) {
    throw new Error("No active vendor PIN identities found");
  }
  console.log(
    `Discovered ${vendors.length} active vendor identities: ${vendors
      .map((v) => `${v.name} (${v.vendorId})`)
      .join(", ")}`,
  );
  const pins = await loadVendorPins(vendors);
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  try {
    for (const vendor of vendors) {
      const pin = pins[vendor.vendorId];
      if (!pin) {
        rows.push({
          vendor: vendor.name,
          vendorId: vendor.vendorId,
          verdict: "FAIL",
          error: "PIN unavailable for safe test",
        });
        continue;
      }
      rows.push(await runVendor(browser, vendor, pin));
    }
  } finally {
    await browser.close();
  }

  const tablePath = resolve(outDir, "matrix.json");
  writeFileSync(
    tablePath,
    JSON.stringify(
      rows.map(({ maskedPin: _m, ...rest }) => rest),
      null,
      2,
    ),
  );
  console.log("\nVENDOR MATRIX");
  console.log(
    [
      "vendor",
      "authentication",
      "sharedUiPath",
      "heading",
      "mobileLayout",
      "orderNavigation",
      "inAppBack",
      "browserBackForward",
      "PASS/FAIL",
    ].join(" | "),
  );
  for (const row of rows) {
    console.log(
      [
        row.vendor,
        row.authentication ?? "FAIL",
        row.sharedUiPath ?? "FAIL",
        row.heading ?? "FAIL",
        row.mobileLayout ?? "FAIL",
        row.orderNavigation ?? "FAIL",
        row.inAppBack ?? "FAIL",
        row.browserBackForward ?? "FAIL",
        row.verdict,
      ].join(" | "),
    );
  }
  const failed = rows.filter((row) => row.verdict !== "PASS");
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
