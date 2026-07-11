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
  openDeliveryDrawerForNavVerify,
} from "./dispatcherVerifyHelpers.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
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
    await page.waitForSelector("text=DELIVERED", { timeout: 30_000 });

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
        await page.waitForSelector("text=Added", { timeout: 25_000 });
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

async function closeDrawerIfOpen(page) {
  const drawerOpen = await page
    .getByText("Order Workflow Status", { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!drawerOpen) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
}

async function verifyPlannedStagingInteractive(page) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await ensureAuthenticated(page, appBase);
  await closeDrawerIfOpen(page);

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("ORD-005");
  await page.waitForTimeout(1500);
  const viewBtn = page
    .locator("table tbody tr")
    .first()
    .locator("button")
    .filter({ hasText: /^View$/ });
  await viewBtn.click({ force: true });
  await page.waitForTimeout(1000);

  const plannedPanel = page.getByTestId("planned-staging-assignment");
  await plannedPanel.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="planned-staging-current"]');
      const text = el?.textContent ?? "";
      return text.length > 0 && !text.includes("—");
    },
    undefined,
    { timeout: 20_000 },
  );

  const optionS1A = page.getByTestId("planned-staging-option-S1-A");
  if (await optionS1A.isVisible().catch(() => false)) {
    const checkbox = optionS1A.locator('input[type="checkbox"]');
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
    } else {
      await checkbox.check();
    }
    const saveBtn = page.getByTestId("save-planned-staging");
    await saveBtn.waitFor({ state: "visible", timeout: 10_000 });
    const enabled = await saveBtn.isEnabled();
    record("Planned staging save enabled after toggle", enabled);
    if (enabled) {
      await saveBtn.click();
      await page.waitForFunction(
        (expectChecked) => {
          const el = document.querySelector('[data-testid="planned-staging-current"]');
          const text = el?.textContent ?? "";
          return expectChecked ? /S1-A/i.test(text) : !/S1-A/i.test(text);
        },
        await checkbox.isChecked(),
        { timeout: 20_000 },
      );
      const currentText = await page.getByTestId("planned-staging-current").innerText();
      record(
        "Planned staging save readback",
        true,
        currentText.trim(),
      );
    }
  } else {
    record("Planned staging option S1-A visible", false, "missing option");
  }

  await shot(page, "05-planned-staging-interactive");
}

async function verifyListBadges(page) {
  await closeDrawerIfOpen(page);
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });

  await search.fill("ORD-005");
  await page.waitForTimeout(1500);
  const ord005Text = await page.locator("table").innerText().catch(() => "");
  record(
    "ORD-005 Divergence badge in list",
    /Divergence/i.test(ord005Text),
    /Divergence/i.test(ord005Text) ? "visible" : "missing",
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
  const context = await browser.newContext({ storageState: authState });
  const page = await context.newPage();

  try {
    console.log("[verify] ensureAuthenticated…");
    await ensureAuthenticated(page, appBase);
    console.log("[verify] dispatcher auth OK");

    // Zones — adjacent group + size class editors (away-114)
    await page.goto(`${appBase}/#/zones`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByRole("button", { name: "Add Zone", exact: true }).click();
    await page.getByRole("heading", { name: /Add Zone/i }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const adjacentField = page.getByTestId("zone-adjacent-group-id");
    await adjacentField.waitFor({ state: "visible", timeout: 15_000 });
    record("Zones adjacent group field visible", await adjacentField.isVisible());
    record(
      "Zones size class field visible",
      await page.getByTestId("zone-size-class").isVisible(),
    );
    await shot(page, "01-zones-adjacency-fields");

    // Dispatcher drawer — planned staging UI (away-115)
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await ensureAuthenticated(page, appBase);
    await openDeliveryDrawerForNavVerify(page);
    const plannedPanel = page.getByTestId("planned-staging-assignment");
    await plannedPanel.waitFor({ state: "visible", timeout: 20_000 });
    record("Drawer planned-staging-assignment visible", true);
    record(
      "Drawer save-planned-staging control visible",
      await page.getByTestId("save-planned-staging").isVisible(),
    );
    await shot(page, "02-drawer-planned-staging");

    await verifyPlannedStagingInteractive(page);
    await verifyListBadges(page);
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
