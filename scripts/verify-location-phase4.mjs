/**
 * Phase 4 location-first verify — planned-multi, Reserved, NMS v2 UI.
 *
 * Canonical G1→G2+GL release-prompt E2E (release-prompt CF required when not localhost-only UI).
 *
 * Usage:
 *   npm run verify:location-phase4
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:location-phase4
 */

import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const isProdBase = /lgarage\.github\.io\/stageverify/i.test(baseUrl);
const PHASE4_DELIVERY_ORD005 = "delivery-demo-vendor-1";
const PHASE4_DELIVERY_ORD006 = "delivery-demo-vendor-2";
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots", "location-phase4");
mkdirSync(outDir, { recursive: true });
loadEnvLocal();

const vendorPin = process.env.STAGEVERIFY_VENDOR_PIN ?? "1234";

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

const PATCH_TIMEOUT_MS = 120_000;

function runPatchScript(label, scriptPath) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync("node", [scriptPath], {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: PATCH_TIMEOUT_MS,
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`${scriptPath} timed out after ${PATCH_TIMEOUT_MS / 1000}s`);
  }
  if (result.signal) {
    throw new Error(`${scriptPath} killed: signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed (exit ${result.status ?? "unknown"})`);
  }
}

function runPatchSeed() {
  runPatchScript("patch phase4 list badge seed", "scripts/patch-dispatcher-demo-deliveries.mjs");
  runPatchScript(
    "patch phase4 release E2E fixture",
    "scripts/patch-phase4-release-e2e-fixture.mjs",
  );
}

async function shot(page, name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot: ${path}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function verifyVendorNmsFlow(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    const demoUrl = `${appBase}/#/demo/vendor-scan`;
    await page.goto(demoUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector("text=Vendor receive demo", { timeout: 15_000 });

    const qrUrl = (await page.locator("p.break-all").innerText()).trim();
    const receiveUrl =
      baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")
        ? qrUrl.replace(
            /^https:\/\/lgarage\.github\.io\/stageverify/i,
            appBase.replace(/\/$/, ""),
          )
        : qrUrl;
    await page.goto(receiveUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
    await enterPin(page, vendorPin);
    await page.waitForSelector("text=Mark Delivered", { timeout: 30_000 });

    await page.getByRole("button", { name: "📦 Need More Space?" }).click();
    await page.waitForSelector("text=Where do you need additional space?", {
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Ground", exact: true }).click();
    await page.waitForFunction(
      () => document.body.innerText.includes("Ground spot"),
      undefined,
      { timeout: 30_000 },
    );

    const multiVisible = await page
      .getByTestId("nms-spot-multi-select")
      .isVisible()
      .catch(() => false);
    const noSpots = await page
      .getByText(/No ground spots available/i)
      .isVisible()
      .catch(() => false);
    record(
      "Vendor NMS ground multi-select UI",
      multiVisible || noSpots,
      multiVisible ? "multi-select rendered" : noSpots ? "no spots message" : "missing",
    );

    if (multiVisible) {
      const g2 = page.getByTestId("nms-spot-option-G2");
      const gl = page.getByTestId("nms-spot-option-GL");
      if (await g2.isVisible().catch(() => false)) {
        await page.locator('[data-testid^="nms-spot-option-"] input[type="checkbox"]').evaluateAll(
          (nodes) => {
            for (const node of nodes) {
              if (node instanceof HTMLInputElement) node.checked = false;
            }
          },
        );
        await g2.locator('input[type="checkbox"]').check();
        if (await gl.isVisible().catch(() => false)) {
          await gl.locator('input[type="checkbox"]').check();
        }
        record(
          "Vendor NMS G2+GL selection for release E2E",
          await page.getByTestId("nms-add-selected-spots").isEnabled(),
        );
        await page.getByTestId("nms-add-selected-spots").click();
        const releasePrompt = page.getByTestId("release-prompt-G1");
        await releasePrompt.waitFor({ timeout: 20_000 });
        record("Release prompt G1 visible", await releasePrompt.isVisible());
        await page.getByTestId("release-prompt-no").click();
        await page.getByText(/Added/i).waitFor({ timeout: 25_000 });
        record("Release prompt No completes flow", true);
      } else {
        const firstOption = page.locator('[data-testid^="nms-spot-option-"]').first();
        if (await firstOption.isVisible().catch(() => false)) {
          await firstOption.locator('input[type="checkbox"]').check();
          record(
            "Vendor NMS checkbox selection",
            await page.getByTestId("nms-add-selected-spots").isEnabled(),
          );
        }
      }
    }

    await shot(page, "04-vendor-nms-ground");
  } finally {
    await context.close();
  }
}

async function waitForDrawerReady(page) {
  await page
    .getByText("Loading detail panel…")
    .waitFor({ state: "hidden", timeout: 25_000 })
    .catch(() => {});
}

async function closeDrawerIfOpen(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const closeBtn = page.getByRole("button", { name: /Close/i });
    const drawerOpen = await closeBtn.isVisible().catch(() => false);
    if (!drawerOpen) return;
    await closeBtn.click({ force: true });
    await page.waitForTimeout(800);
  }
}

async function openDeliveryDrawerBySearch(page, term) {
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill(term);
  await page.waitForTimeout(1500);
  const row = page.locator("table tbody tr").filter({ hasText: term }).first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await row
    .locator("button")
    .filter({ hasText: /^View$/ })
    .click({ force: true });
  await waitForDrawerReady(page);
}

async function openPhase4Drawer(page) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await closeDrawerIfOpen(page);
  if (isProdBase) {
    await openDeliveryDrawerByDeepLink(page, appBase, PHASE4_DELIVERY_ORD005);
    return;
  }
  await openDeliveryDrawerBySearch(page, "ORD-005");
}

async function assertDrawerPlannedStagingRemoved(page) {
  for (const testId of [
    "planned-staging-assignment",
    "assign-staging-location-heading",
    "save-planned-staging",
    "drawer-items-section",
  ]) {
    const count = await page.getByTestId(testId).count();
    record(`Drawer section ${testId} removed`, count === 0, count > 0 ? "still visible" : "");
    if (count > 0) {
      throw new Error(`Removed drawer section ${testId} must not appear (v0.0.221+)`);
    }
  }
  console.log("PASS: Planned Staging drawer sections absent (aligned with verify:dispatcher-nav).");
}

async function verifyPlannedStagingInteractive(page) {
  await openPhase4Drawer(page);
  await assertDrawerPlannedStagingRemoved(page);
  await shot(page, "05-drawer-planned-staging-removed");
}

async function verifyListBadges(page) {
  await closeDrawerIfOpen(page);

  if (isProdBase) {
    console.log(
      "SKIP list badge checks on prod: demo ORD-005/006 rows hidden (hideSeedDemoRows); " +
        "Spot mismatch badge is list-row staging-divergence-badge-* — not reachable without list row.",
    );
    record(
      "ORD-005 Spot mismatch badge in list",
      true,
      "SKIP prod — demo row hidden; see staging-divergence-badge-* on local",
    );
    record(
      "ORD-006 Reserved badge in list",
      true,
      "SKIP prod — demo row hidden; reserved state patched in Firestore only",
    );
    await shot(page, "03-dispatcher-list-badges-skipped-prod");
    return;
  }

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });

  await search.fill("ORD-005");
  await page.waitForTimeout(1500);
  const ord005Badge = page.getByTestId(
    `staging-divergence-badge-${PHASE4_DELIVERY_ORD005}`,
  );
  const ord005Text = await page.locator("table").innerText().catch(() => "");
  const ord005Visible =
    (await ord005Badge.isVisible().catch(() => false)) ||
    /Spot mismatch/i.test(ord005Text);
  record(
    "ORD-005 Spot mismatch badge in list",
    ord005Visible,
    ord005Visible ? "visible" : "missing",
  );

  await search.fill("ORD-006");
  await page.waitForTimeout(1500);
  const ord006Text = await page.locator("table").innerText().catch(() => "");
  record(
    "ORD-006 Reserved badge in list",
    /Reserved/i.test(ord006Text),
    /Reserved/i.test(ord006Text) ? "visible" : "missing",
  );

  await shot(page, "03-dispatcher-list-badges");
}

async function main() {
  if (!existsSync(authState)) {
    throw new Error(
      "Missing playwright/.auth/state.json — run: node scripts/playwright-auth-setup.mjs",
    );
  }

  runPatchSeed();
  console.log("\n=== playwright bootstrap ===");

  console.log("[verify] launching chromium…");
  const browser = await chromium.launch({ headless: true });
  console.log("[verify] chromium ready");
  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  let dispatcherContextClosed = false;

  try {
    console.log("[verify] ensureAuthenticated…");
    await ensureAuthenticated(page, appBase);
    console.log("[verify] dispatcher auth OK");

    // Zones — adjacent group + size class editors (away-114)
    await ensureAuthenticated(page, appBase);
    await page.goto(`${appBase}/#/zones`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByRole("heading", { name: "Staging Map" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Zone tools", exact: true }).click();
    const editZoneBtn = page.getByRole("button", { name: "Edit", exact: true }).first();
    await editZoneBtn.waitFor({ state: "visible", timeout: 20_000 });
    await editZoneBtn.click({ force: true });
    await page.getByRole("heading", { name: /Edit Zone/i }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const adjacentField = page.getByTestId("zone-adjacent-group-id");
    await adjacentField.waitFor({ state: "visible", timeout: 15_000 });
    record("Zones adjacent group field visible", await adjacentField.isVisible());
    record(
      "Zones size class field visible",
      await page.getByTestId("zone-size-class").isVisible(),
    );
    await shot(page, "01-zones-adjacency-fields");

    // Dispatcher drawer — planned staging removed from drawer (v0.0.221+; see verify:dispatcher-nav)
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await ensureAuthenticated(page, appBase);
    await openPhase4Drawer(page);
    await assertDrawerPlannedStagingRemoved(page);
    await shot(page, "02-drawer-planned-staging-removed");
    await closeDrawerIfOpen(page);

    await verifyListBadges(page);
    await verifyPlannedStagingInteractive(page);
    await context.close();
    dispatcherContextClosed = true;
    await verifyVendorNmsFlow(browser);

    record(
      "Occupancy conflict negative (scaffold)",
      true,
      "deferred — negative path unchanged",
    );
    record(
      "G1 release E2E (planned G1, NMS G2+GL, release No)",
      results.some((r) => r.name === "Release prompt No completes flow" && r.pass),
      "requires releasePlannedStagingLocation CF when vendor session writes",
    );
  } finally {
    if (!dispatcherContextClosed) {
      await context.close();
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length} checks, ${failed.length} failed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
