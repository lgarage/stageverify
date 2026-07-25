/**
 * Playwright: Settings → Workflow → Staging Spots (map-synced list, D-52).
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-staging
 *
 * Credentials from .env.local (STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD).
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast, MIN_LARGE_TEXT_CONTRAST, MIN_TEXT_CONTRAST } from "./lib/ui-text-contrast-lib.mjs";

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
const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

const appBase = resolveAppBase(baseUrl);

function normalizeSpotKey(code) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Mirror of compareStagingMapLayoutSlots — SSOT: src/dispatcher/stagingMapSync.ts (D-53). */
function layoutSlotSortRank(key) {
  const norm = normalizeSpotKey(key);
  if (norm === "CA") return { kind: -1, primary: 0, secondary: 0 };
  const ground = /^G(\d+)$/.exec(norm);
  if (ground) return { kind: 0, primary: Number(ground[1]), secondary: 0 };
  const shelf = /^S(\d+)([A-Z])$/.exec(norm);
  if (shelf) {
    return {
      kind: 1,
      primary: Number(shelf[1]),
      secondary: shelf[2].charCodeAt(0) - 65,
    };
  }
  return { kind: 2, primary: 0, secondary: 0 };
}

function compareStagingMapLayoutSlots(a, b) {
  const rankA = layoutSlotSortRank(a);
  const rankB = layoutSlotSortRank(b);
  if (rankA.kind !== rankB.kind) return rankA.kind - rankB.kind;
  if (rankA.primary !== rankB.primary) return rankA.primary - rankB.primary;
  if (rankA.secondary !== rankB.secondary) return rankA.secondary - rankB.secondary;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function assertSettingsStagingListSortOrder(editIdsInDomOrder) {
  const codes = editIdsInDomOrder.filter(Boolean);
  const sorted = [...codes].sort(compareStagingMapLayoutSlots);
  for (let i = 0; i < codes.length; i++) {
    if (normalizeSpotKey(codes[i]) !== normalizeSpotKey(sorted[i])) {
      throw new Error(
        `Settings staging list order violates D-53 (CA → G* → S*) at row ${i + 1}: DOM=${codes[i]}, expected=${sorted[i]}`,
      );
    }
  }
  console.log("PASS: Settings staging list sort order (D-53 CA → G* → S*).");
}

async function collectMapStagingSpotKeys(page) {
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-testid^="shop-spot-"]:not([data-testid="shop-spot-catch-all-label"])',
      ).length >= 12,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(800);
  const layoutSlots = await page
    .locator(
      '[data-testid^="shop-spot-"]:not([data-testid="shop-spot-catch-all-label"])',
    )
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.getAttribute("data-testid")?.replace("shop-spot-", "") ?? "",
      ),
    );
  const keys = layoutSlots.map((s) => normalizeSpotKey(s)).filter(Boolean);
  const catchAll = await page
    .locator('[data-testid="shop-map-catch-all"]')
    .count();
  if (catchAll > 0) {
    keys.push("CA");
  }
  keys.sort();
  return keys;
}

function trySeed(status) {
  try {
    execSync(`node scripts/seed-email-oauth-fixture.mjs --status=${status}`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    console.warn(
      `SKIP seed --status=${status} (ADC unavailable — assuming ${status} UI state)`,
    );
    return false;
  }
}

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  if (!page.url().includes("/login")) return;

  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(settings|dispatcher|hub)/, { timeout: 20_000 });

  if (!page.url().includes("/settings")) {
    await page.goto(`${appBase}/#/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

async function countMapStagingSpots(page) {
  const keys = await collectMapStagingSpotKeys(page);
  return keys.length;
}

(async () => {
  trySeed("disconnected");

  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/settings`);
  await ensureAuthenticated(page);

  await page.getByText("Staging Spots", { exact: true }).first().waitFor({
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="settings-staging-spots-section"]', {
    timeout: 15_000,
  });
  await page.waitForSelector("text=On Staging Map", { timeout: 10_000 });

  const addForm = page.getByText("Add Staging Spot", { exact: true });
  if (await addForm.count()) {
    throw new Error(
      "Settings still shows Add Staging Spot form — map-only list expected (D-52)",
    );
  }

  await page.getByText("Staging Spots", { exact: true }).first().scrollIntoViewIfNeeded();

  console.log("Email Monitoring settings (save + reload)…");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Email Monitoring", { exact: true }).first().waitFor({
    timeout: 10_000,
  });

  const inboxInput = page.getByTestId("monitoring-inbox-email");
  const badge = page.getByTestId("gmail-oauth-status-badge");
  await badge.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="gmail-oauth-status-badge"]');
      return el && !/loading/i.test(el.textContent ?? "");
    },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);
  const gmailStatus = await badge.getAttribute("data-status");
  const inboxVisible = await inboxInput.isVisible().catch(() => false);

  if (gmailStatus !== "disconnected" || !inboxVisible) {
    console.log(
      "SKIP inbox edit — Gmail linked; toggling monitoring enabled only…",
    );
    const enableCheckbox = page.getByTestId("email-monitoring-enabled");
    const originalEnabled = await enableCheckbox.isChecked();
    await enableCheckbox.setChecked(!originalEnabled);
    await page.getByTestId("save-email-settings").click();
    await page.getByTestId("email-settings-saved").waitFor({ timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("email-monitoring-enabled").waitFor({ timeout: 15_000 });
    const reloadedEnabled = await page
      .getByTestId("email-monitoring-enabled")
      .isChecked();
    if (reloadedEnabled === originalEnabled) {
      throw new Error("emailMonitoringEnabled did not persist when Gmail connected");
    }
    await page.getByTestId("email-monitoring-enabled").setChecked(originalEnabled);
    await page.getByTestId("save-email-settings").click();
    await page
      .getByTestId("email-settings-saved")
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    console.log("PASS: Email Monitoring toggle save verified (Gmail connected).");
  } else {
    await inboxInput.waitFor({ state: "visible", timeout: 10_000 });
    const enableCheckbox = page.getByTestId("email-monitoring-enabled");
    const originalEmail = await inboxInput.inputValue();
    const originalEnabled = await enableCheckbox.isChecked();

    const probeEmail = "verify-inbox@stageverify.test";
    await inboxInput.fill(probeEmail);
    await enableCheckbox.check();
    await page.waitForFunction(
      (probe) => {
        const el = document.querySelector('[data-testid="monitoring-inbox-email"]');
        const cb = document.querySelector('[data-testid="email-monitoring-enabled"]');
        return el?.value === probe && cb?.checked === true;
      },
      probeEmail,
      { timeout: 10_000 },
    );
    await page.getByTestId("save-email-settings").click();
    await page.getByTestId("email-settings-saved").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("monitoring-inbox-email").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    const reloadedEmail = await page.getByTestId("monitoring-inbox-email").inputValue();
    const reloadedEnabled = await page
      .getByTestId("email-monitoring-enabled")
      .isChecked();
    if (reloadedEmail !== probeEmail) {
      throw new Error(
        `Inbox email did not persist after reload (expected ${probeEmail}, got ${reloadedEmail})`,
      );
    }
    if (!reloadedEnabled) {
      throw new Error("emailMonitoringEnabled did not persist after reload");
    }

    await page.getByTestId("monitoring-inbox-email").fill(originalEmail);
    if (originalEnabled) {
      await page.getByTestId("email-monitoring-enabled").check();
    } else {
      await page.getByTestId("email-monitoring-enabled").uncheck();
    }
    await page.waitForTimeout(400);
    await page.getByTestId("save-email-settings").click();
    await page
      .getByTestId("email-settings-saved")
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(1000);

    console.log("PASS: Email Monitoring settings save + reload verified.");
  }

  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page
    .getByText("Staging Spots", { exact: true })
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  await page.waitForSelector('[data-testid="settings-staging-spots-section"]', {
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => !/Loading spots/i.test(document.body.textContent ?? ""),
    { timeout: 45_000 },
  );
  await page.waitForTimeout(400);

  const editIds = await page
    .locator('[data-testid^="edit-spot-"]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")?.replace("edit-spot-", "") ?? ""),
    );
  const settingsKeys = editIds.map((c) => normalizeSpotKey(c)).filter(Boolean);
  const settingsEditButtons = editIds.length;

  const sectionText = await page
    .locator('[data-testid="settings-staging-spots-section"]')
    .innerText();
  const expectedCountMatch = sectionText.match(/(\d+)\s+spots on map/i);
  const expectedSpotCount = expectedCountMatch
    ? Number(expectedCountMatch[1])
    : settingsEditButtons;

  let mapSpotKeys = await collectMapStagingSpotKeys(page);
  for (let attempt = 0; attempt < 24; attempt++) {
    if (mapSpotKeys.length === expectedSpotCount) break;
    await page.waitForTimeout(500);
    mapSpotKeys = await collectMapStagingSpotKeys(page);
  }
  const mapSpotCount = mapSpotKeys.length;

  const mapKeySet = new Set(mapSpotKeys);
  const settingsKeySet = new Set(settingsKeys);

  if (settingsKeys.length !== mapSpotKeys.length) {
    const onlyMap = mapSpotKeys.filter((k) => !settingsKeySet.has(k));
    const onlySettings = settingsKeys.filter((k) => !mapKeySet.has(k));
    throw new Error(
      `Settings row count (${settingsKeys.length}) ≠ Staging Map chips (${mapSpotKeys.length}) — D-52 parity` +
        (onlyMap.length ? `; on map only: ${onlyMap.join(", ")}` : "") +
        (onlySettings.length ? `; settings only: ${onlySettings.join(", ")}` : ""),
    );
  }

  for (const key of mapKeySet) {
    if (!settingsKeySet.has(key)) {
      throw new Error(
        `Map chip ${key} missing from Settings staging list — D-52 parity`,
      );
    }
  }
  for (const key of settingsKeySet) {
    if (!mapKeySet.has(key)) {
      throw new Error(
        `Settings row ${key} has no Staging Map chip — D-52 parity`,
      );
    }
  }

  assertSettingsStagingListSortOrder(editIds);

  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector('[data-testid="shop-floor-map"]', { timeout: 30_000 });

  for (const code of editIds) {
    if (!code) continue;
    const key = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const ca = key === "CA";
    const onMap = ca
      ? (await page.locator('[data-testid="shop-map-catch-all"]').count()) > 0
      : (await page.locator(`[data-testid="shop-spot-${key}"]`).count()) > 0 ||
        (await page.locator(`[data-testid="shop-spot-${code}"]`).count()) > 0;
    if (!onMap) {
      throw new Error(
        `Settings spot ${code} has no matching Staging Map chip (D-52)`,
      );
    }
  }

  console.log(
    `PASS: Settings list ↔ map parity (${settingsEditButtons} rows, ${mapSpotCount} map chips).`,
  );

  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector('[data-testid="settings-staging-spots-section"]', {
    timeout: 20_000,
  });
  await page
    .getByText("Staging Spots", { exact: true })
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="edit-spot-"]').length > 0,
    { timeout: 45_000 },
  );

  const editIdsForProbe = await page
    .locator('[data-testid^="edit-spot-"]')
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.getAttribute("data-testid")?.replace("edit-spot-", "") ?? "",
      ),
    );
  if (editIdsForProbe.length > 0) {
    const groundCode = editIdsForProbe.find((c) =>
      /^G\d+$/i.test(normalizeSpotKey(c)),
    );
    const spotCode = groundCode ?? editIdsForProbe[0] ?? "G1";
    const editBtn = page.locator(`[data-testid="edit-spot-${spotCode}"]`);
    if ((await editBtn.count()) === 0) {
      throw new Error(`Missing edit-spot-${spotCode} for label save probe`);
    }
    await editBtn.waitFor({ timeout: 10_000 });
    await editBtn.click();

    await page.getByTestId("edit-spot-label").waitFor({ timeout: 10_000 });

    const labelInput = page.getByTestId("edit-spot-label");
    let originalLabel = await labelInput.inputValue();
    originalLabel = originalLabel.replace(/ \(verify\)$/, "");
    const probeLabel = `${originalLabel} (verify)`;
    await labelInput.fill(probeLabel);
    await page.getByTestId(`save-spot-${spotCode}`).click();
    await page
      .getByTestId(`spot-label-${spotCode}`)
      .filter({ hasText: probeLabel })
      .waitFor({
        timeout: 25_000,
      });

    await editBtn.click();
    await page.getByTestId("edit-spot-label").waitFor({ timeout: 10_000 });
    await page.getByTestId("edit-spot-label").fill(originalLabel);
    await page.getByTestId(`save-spot-${spotCode}`).click();
    await page
      .getByTestId(`spot-label-${spotCode}`)
      .filter({ hasText: originalLabel })
      .waitFor({
        timeout: 25_000,
      });
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="settings-staging-spots-section"]',
    elements: [
      {
        name: "Staging Spots heading",
        selector: "span",
        large: true,
      },
      {
        name: "section body copy",
        selector: "p",
        optional: true,
      },
    ],
    minText: MIN_TEXT_CONTRAST,
    minLarge: MIN_LARGE_TEXT_CONTRAST,
  });

  await page.screenshot({
    path: resolve(outDir, "settings-staging-spots.png"),
    fullPage: true,
  });

  console.log("PASS: Settings workflow staging spots section verified.");
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
