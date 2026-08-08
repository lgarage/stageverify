/**
 * Playwright: dispatcher deliveries table Released To + drawer job release panel.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:dispatcher-job-release
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  JOB_RELEASE_PANEL_CONTRAST_SPEC,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  RELEASED_TO_BADGE_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerByDeepLink,
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
const outDir = resolve(process.cwd(), "screenshots/dispatcher-job-release");
loadEnvLocal();

function isProdLikeBase(url) {
  return url.includes("lgarage.github.io");
}

async function openDrawerForJobReleaseVerify(page) {
  if (isProdLikeBase(baseUrl)) {
    const openId =
      process.env.STAGEVERIFY_OPEN_DELIVERY?.trim() ||
      process.env.STAGEVERIFY_VERIFY_DELIVERY_ID?.trim();
    if (openId) {
      await openDeliveryDrawerByDeepLink(page, appBase, openId);
      return { method: "deep-link", deliveryId: openId };
    }
    const firstReleasedCell = page.locator('[data-testid^="released-to-"]').first();
    if ((await firstReleasedCell.count()) > 0) {
      const testId = (await firstReleasedCell.getAttribute("data-testid")) ?? "";
      const deliveryId = testId.replace(/^released-to-/, "");
      if (deliveryId) {
        await openDeliveryDrawerByDeepLink(page, appBase, deliveryId);
        return { method: "deep-link-from-table", deliveryId };
      }
    }
    throw new Error(
      "Prod verify: set STAGEVERIFY_OPEN_DELIVERY or ensure deliveries table has rows (hideSeedDemoRows).",
    );
  }

  await openDeliveryDrawerForNavVerify(page);
  return { method: "search+view" };
}

async function assertAssignedView(page) {
  const editBtn = page.getByTestId("job-release-edit-btn");
  await editBtn.waitFor({ state: "visible", timeout: 10_000 });
  const select = page.getByTestId("job-release-technician-select");
  if ((await select.count()) > 0 && (await select.isVisible())) {
    throw new Error(
      "Assigned view must hide technician select — Edit + badge only.",
    );
  }
  const submit = page.getByTestId("job-release-submit");
  if ((await submit.count()) > 0 && (await submit.isVisible())) {
    throw new Error(
      "Assigned view must hide Release button — Edit + badge only.",
    );
  }
}

async function loadEligibleTechOptions(techSelect) {
  const options = techSelect.locator("option:not([value=''])");
  const optionCount = await options.count();
  const result = [];
  for (let i = 0; i < optionCount; i++) {
    const opt = options.nth(i);
    result.push({
      value: (await opt.getAttribute("value")) ?? "",
      label: (await opt.innerText()).trim(),
    });
  }
  return result;
}

async function assignTechInDrawer(page, techId) {
  await page.getByTestId("job-release-technician-select").selectOption(techId);
  await page.getByTestId("job-release-submit").click();
  await page.getByTestId("job-release-success").waitFor({ timeout: 20_000 });
  const err = page.getByTestId("job-release-error");
  if ((await err.count()) > 0 && (await err.isVisible())) {
    throw new Error(`Assign failed: ${(await err.innerText()).trim()}`);
  }
}

async function assertExclusiveDrawerBadge(page, techId) {
  const badges = page.locator('[data-testid^="job-release-current-badge-"]');
  const count = await badges.count();
  if (count !== 1) {
    throw new Error(`Exclusive assign: expected 1 drawer badge, got ${count}`);
  }
  const badge = page.getByTestId(`job-release-current-badge-${techId}`);
  if ((await badge.count()) === 0) {
    throw new Error(`Exclusive assign: drawer badge missing for tech ${techId}`);
  }
}

async function assertTableBadgesForDelivery(page, deliveryId, expectedTechIds) {
  if (!deliveryId) return;
  const cell = page.locator(`[data-testid="released-to-${deliveryId}"]`);
  if ((await cell.count()) === 0) return;

  const waitMs = 20_000;
  try {
    await page.waitForFunction(
      ({ id, techIds }) => {
        const cellEl = document.querySelector(
          `[data-testid="released-to-${id}"]`,
        );
        if (!cellEl) return false;
        const badges = cellEl.querySelectorAll(
          '[data-testid^="released-to-badge-"]',
        );
        if (badges.length !== techIds.length) return false;
        return techIds.every((techId) =>
          cellEl.querySelector(
            `[data-testid="released-to-badge-${id}-${techId}"]`,
          ),
        );
      },
      { id: deliveryId, techIds: expectedTechIds },
      { timeout: waitMs },
    );
  } catch {
    const badges = cell.locator('[data-testid^="released-to-badge-"]');
    const count = await badges.count();
    throw new Error(
      `Table Released To: expected ${expectedTechIds.length} badge(s) within ${waitMs / 1000}s, got ${count}`,
    );
  }
}

async function assertNoTableBadgesForDelivery(page, deliveryId) {
  if (!deliveryId) return;
  const cell = page.locator(`[data-testid="released-to-${deliveryId}"]`);
  if ((await cell.count()) === 0) return;

  const waitMs = 15_000;
  try {
    await page.waitForFunction(
      (id) => {
        const cellEl = document.querySelector(
          `[data-testid="released-to-${id}"]`,
        );
        if (!cellEl) return true;
        return (
          cellEl.querySelectorAll('[data-testid^="released-to-badge-"]')
            .length === 0
        );
      },
      deliveryId,
      { timeout: waitMs },
    );
  } catch {
    const badges = cell.locator('[data-testid^="released-to-badge-"]');
    const count = await badges.count();
    throw new Error(
      `Unassign: expected 0 table badges within ${waitMs / 1000}s, got ${count}`,
    );
  }
}

(async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/dispatcher`);
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  const releasedHeader = page.getByRole("columnheader", { name: "Released To" });
  await releasedHeader.waitFor({ timeout: 20_000 });
  console.log("PASS: Deliveries table has Released To column");

  const drawerOpen = await openDrawerForJobReleaseVerify(page);
  console.log(`PASS: Opened drawer (${drawerOpen.method})`);

  await page
    .getByTestId("job-release-to-technician-panel")
    .waitFor({ timeout: 20_000 });
  await page
    .getByTestId("job-release-to-technician-panel")
    .scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => {
      const edit = document.querySelector('[data-testid="job-release-edit-btn"]');
      const select = document.querySelector(
        '[data-testid="job-release-technician-select"]',
      );
      const panel = document.querySelector(
        '[data-testid="job-release-to-technician-panel"]',
      );
      const loading = panel?.textContent?.includes("Loading");
      const editVisible =
        edit instanceof HTMLElement && edit.offsetParent !== null;
      const selectVisible =
        select instanceof HTMLElement && select.offsetParent !== null;
      return editVisible || selectVisible || !loading;
    },
    { timeout: 30_000 },
  );
  const editBtn = page.getByTestId("job-release-edit-btn");
  const techSelect = page.getByTestId("job-release-technician-select");
  const alreadyAssigned =
    (await editBtn.count()) > 0 && (await editBtn.isVisible());

  let firstTechValue = "";
  const loadFirstTechValue = async () => {
    const options = await loadEligibleTechOptions(techSelect);
    if (options.length === 0) {
      throw new Error(
        "No eligible technicians — add an active technician in Settings first.",
      );
    }
    firstTechValue = options[0].value;
    return firstTechValue;
  };

  if (alreadyAssigned) {
    console.log("PASS: Job already assigned — assigned view (badge + Edit)");
    const assignedBar = page.getByTestId("job-release-assigned-bar");
    await assignedBar.waitFor({ state: "visible", timeout: 10_000 });
    const barBg = await assignedBar.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    if (barBg !== "rgb(10, 49, 97)") {
      throw new Error(
        `Assigned release bar must use navy fill — got ${barBg}`,
      );
    }
    console.log("PASS: Assigned panel bar navy styling");
    await assertAssignedView(page);
    await assertReadableTextContrast(page, JOB_RELEASE_PANEL_CONTRAST_SPEC);
    console.log(
      `PASS: Assigned panel contrast (≥${MIN_TEXT_CONTRAST}:1 / ≥${MIN_LARGE_TEXT_CONTRAST}:1 large)`,
    );
  } else {
    await techSelect.waitFor({ state: "visible", timeout: 20_000 });

    await loadFirstTechValue();
    await techSelect.selectOption(firstTechValue);
    await page.waitForFunction(() => {
      const btn = document.querySelector(
        '[data-testid="job-release-submit"]',
      );
      if (!(btn instanceof HTMLButtonElement) || btn.disabled) return false;
      const bg = getComputedStyle(btn).backgroundColor;
      return bg === "rgb(10, 49, 97)";
    });
    await assertReadableTextContrast(page, JOB_RELEASE_PANEL_CONTRAST_SPEC);
    console.log(
      `PASS: Unassigned panel contrast (≥${MIN_TEXT_CONTRAST}:1 / ≥${MIN_LARGE_TEXT_CONTRAST}:1 large)`,
    );

    await page.getByTestId("job-release-submit").click();
    await page.getByTestId("job-release-success").waitFor({ timeout: 20_000 });
    const errorBanner = page.getByTestId("job-release-error");
    if ((await errorBanner.count()) > 0 && (await errorBanner.isVisible())) {
      const msg = (await errorBanner.innerText()).trim();
      throw new Error(`Release failed in UI: ${msg}`);
    }
    console.log("PASS: Assign technician callable succeeded");
    await assertAssignedView(page);
    console.log("PASS: Post-release assigned view hides picker");
  }

  await page.getByTestId("job-release-edit-btn").click();
  await techSelect.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("job-release-cancel-edit").click();
  await assertAssignedView(page);
  console.log("PASS: Edit → Cancel returns to badge + Edit view");

  await page.getByTestId("job-release-edit-btn").click();
  await techSelect.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("job-release-unassign").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await page.getByTestId("job-release-unassign").click();
  await page.getByTestId("job-release-success").waitFor({ timeout: 20_000 });
  const unassignError = page.getByTestId("job-release-error");
  if ((await unassignError.count()) > 0 && (await unassignError.isVisible())) {
    throw new Error(
      `Unassign failed in drawer: ${(await unassignError.innerText()).trim()}`,
    );
  }
  await techSelect.waitFor({ state: "visible", timeout: 10_000 });
  console.log("PASS: Edit → Unassign clears assignment and shows picker");

  const tableDeliveryIdEarly = drawerOpen.deliveryId ?? "";
  const eligibleTechs = await loadEligibleTechOptions(techSelect);
  if (eligibleTechs.length < 2) {
    console.log(
      `SKIP: A→B exclusive reassign — only ${eligibleTechs.length} eligible technician(s); assign/unassign/single-badge still covered`,
    );
  } else {
    const techA = eligibleTechs[0];
    const techB = eligibleTechs[1];
    console.log(
      `Testing exclusive assign ${techA.label} → ${techB.label}`,
    );

    await assignTechInDrawer(page, techA.value);
    await assertAssignedView(page);
    await assertExclusiveDrawerBadge(page, techA.value);
    await assertTableBadgesForDelivery(page, tableDeliveryIdEarly, [
      techA.value,
    ]);
    console.log(`PASS: Assign ${techA.label} — single drawer + table badge`);

    await page.getByTestId("job-release-edit-btn").click();
    await techSelect.waitFor({ state: "visible", timeout: 10_000 });
    await assignTechInDrawer(page, techB.value);
    await assertAssignedView(page);
    await assertExclusiveDrawerBadge(page, techB.value);
    const staleDrawerA = page.getByTestId(
      `job-release-current-badge-${techA.value}`,
    );
    if ((await staleDrawerA.count()) > 0) {
      throw new Error(
        `Reassign: stale drawer badge for ${techA.label} still visible`,
      );
    }
    await assertTableBadgesForDelivery(page, tableDeliveryIdEarly, [
      techB.value,
    ]);
    const staleTableA = page.getByTestId(
      `released-to-badge-${tableDeliveryIdEarly}-${techA.value}`,
    );
    if ((await staleTableA.count()) > 0) {
      throw new Error(
        `Reassign: stale table badge for ${techA.label}`,
      );
    }
    console.log(
      `PASS: Reassign to ${techB.label} — only B visible; A removed`,
    );

    await page.getByTestId("job-release-edit-btn").click();
    await page.getByTestId("job-release-unassign").click();
    await page.getByTestId("job-release-success").waitFor({ timeout: 20_000 });
    const exclusiveUnassignErr = page.getByTestId("job-release-error");
    if (
      (await exclusiveUnassignErr.count()) > 0 &&
      (await exclusiveUnassignErr.isVisible())
    ) {
      throw new Error(
        `Exclusive unassign failed: ${(await exclusiveUnassignErr.innerText()).trim()}`,
      );
    }
    await techSelect.waitFor({ state: "visible", timeout: 10_000 });
    const drawerBadgesAfter = await page
      .locator('[data-testid^="job-release-current-badge-"]')
      .count();
    if (drawerBadgesAfter !== 0) {
      throw new Error(
        `Exclusive unassign: expected 0 drawer badges, got ${drawerBadgesAfter}`,
      );
    }
    await assertNoTableBadgesForDelivery(page, tableDeliveryIdEarly);
    console.log("PASS: Exclusive unassign — no drawer or table badges");
  }

  if (!firstTechValue) {
    await loadFirstTechValue();
  }
  await techSelect.selectOption(firstTechValue);
  await page.getByTestId("job-release-submit").click();
  await page.getByTestId("job-release-success").waitFor({ timeout: 20_000 });
  await assertAssignedView(page);
  console.log("PASS: Re-assign after unassign for table badge test");

  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid^="released-to-unassign-"]').length >
        0 ||
      document.querySelectorAll('[data-testid^="released-to-badge-"]').length > 0,
    { timeout: 20_000 },
  ).catch(() => {});

  let tableDeliveryId = drawerOpen.deliveryId ?? "";
  if (!tableDeliveryId) {
    const unassignEl = page.locator('[data-testid^="released-to-unassign-"]').first();
    if ((await unassignEl.count()) > 0) {
      const testId = (await unassignEl.getAttribute("data-testid")) ?? "";
      tableDeliveryId = testId.replace(/^released-to-unassign-/, "");
    }
  }

  const badgeCount = await page
    .locator('[data-testid^="released-to-badge-"]')
    .count();
  if (badgeCount > 0) {
    await assertReadableTextContrast(page, RELEASED_TO_BADGE_CONTRAST_SPEC);
    console.log("PASS: Released To table badge contrast");
  } else {
    console.log(
      "SKIP: No Released To badges in table after re-release — column + drawer panel verified",
    );
  }

  const tableUnassignBtn = page.locator(
    `[data-testid="released-to-unassign-${tableDeliveryId}"]`,
  );
  if (tableDeliveryId && (await tableUnassignBtn.count()) > 0) {
    if (isProdLikeBase(baseUrl)) {
      await page.evaluate(() => { window.location.hash = "/dispatcher"; });
      await page.waitForTimeout(300);
    }
    const drawer = page.getByTestId("delivery-detail-drawer");
    if (await drawer.isVisible().catch(() => false)) {
      await drawer.getByRole("button", { name: /Close/i }).click();
      await drawer.waitFor({ state: "hidden", timeout: 10_000 });
    } else {
      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    await tableUnassignBtn.click({ trial: false });
    await page.waitForFunction(
      (deliveryId) => {
        const cell = document.querySelector(
          `[data-testid="released-to-${deliveryId}"]`,
        );
        if (!cell) return false;
        const badges = cell.querySelectorAll(
          '[data-testid^="released-to-badge-"]',
        );
        const unassign = cell.querySelector(
          `[data-testid="released-to-unassign-${deliveryId}"]`,
        );
        return badges.length === 0 && !unassign;
      },
      tableDeliveryId,
      { timeout: 20_000 },
    );
    console.log("PASS: Table Released To × unassign clears badges");
  } else {
    const anyUnassign = page.locator('[data-testid^="released-to-unassign-"]');
    if ((await anyUnassign.count()) > 0) {
      const testId = (await anyUnassign.first().getAttribute("data-testid")) ?? "";
      const deliveryId = testId.replace(/^released-to-unassign-/, "");
      if (isProdLikeBase(baseUrl)) {
        await page.evaluate(() => { window.location.hash = "/dispatcher"; });
        await page.waitForTimeout(300);
      }
      const drawer = page.getByTestId("delivery-detail-drawer");
      if (await drawer.isVisible().catch(() => false)) {
        await drawer.getByRole("button", { name: /Close/i }).click();
        await drawer.waitFor({ state: "hidden", timeout: 10_000 });
      } else {
        await page.keyboard.press("Escape");
        await drawer.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
      }
      await page.waitForTimeout(500);
      await anyUnassign.first().click();
      await page.waitForFunction(
        (id) => {
          const cell = document.querySelector(`[data-testid="released-to-${id}"]`);
          if (!cell) return false;
          return (
            cell.querySelectorAll('[data-testid^="released-to-badge-"]').length ===
              0 && !cell.querySelector(`[data-testid="released-to-unassign-${id}"]`)
          );
        },
        deliveryId,
        { timeout: 20_000 },
      );
      console.log("PASS: Table Released To × unassign clears badges");
    } else {
      console.log(
        "SKIP: No table unassign control visible — drawer unassign verified",
      );
    }
  }

  await page.screenshot({
    path: resolve(outDir, "dispatcher-drawer-job-release.png"),
    fullPage: false,
  });
  await page.locator("table").first().screenshot({
    path: resolve(outDir, "dispatcher-table-released-to.png"),
  });

  console.log("PASS: verify:dispatcher-job-release");
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
