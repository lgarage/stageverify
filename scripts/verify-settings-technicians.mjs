/**
 * Playwright: Settings → PIN & Access Management technician roster/detail.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-technicians
 *
 * Credentials from .env.local (STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD).
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  TECHNICIAN_PANEL_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/settings`);
  await ensureAuthenticated(page);

  await page
    .getByRole("heading", { name: "PIN & Access Management", exact: true })
    .waitFor({ timeout: 30_000 });
  await page.getByTestId("technician-settings-panel").waitFor({ timeout: 15_000 });
  await page.getByTestId("technician-settings-panel").scrollIntoViewIfNeeded();
  await page.getByTestId("pin-access-roster").waitFor({ timeout: 15_000 });

  const technicianEdit = page.locator(
    '[data-testid^="pin-access-edit-technician-"]',
  ).first();
  if (await technicianEdit.count()) {
    await technicianEdit.click();
    await page.getByTestId("pin-access-detail").waitFor({ timeout: 10_000 });
    await page
      .locator('[data-testid^="technician-perm-door-"]')
      .first()
      .waitFor({ timeout: 10_000 });
    const releaseSelect = page.getByTestId("technician-release-select");
    const releaseJobList = page.getByTestId("technician-release-job-list");
    const releaseSave = page.getByTestId("technician-release-save");
    if ((await releaseSelect.count()) > 0) {
      throw new Error(
        "Settings release UI must be removed — technician-release-select still present.",
      );
    }
    if ((await releaseJobList.count()) > 0) {
      throw new Error(
        "Settings release UI must be removed — technician-release-job-list still present.",
      );
    }
    if ((await releaseSave.count()) > 0) {
      throw new Error(
        "Settings release UI must be removed — technician-release-save still present.",
      );
    }
  }
  await page.waitForTimeout(500);

  const countInactiveRosterRows = async () =>
    page
      .locator('[data-testid="pin-access-roster"] tbody tr[data-testid^="pin-access-row-"]')
      .evaluateAll((rowNodes) =>
        rowNodes.filter((row) => {
          const cells = row.querySelectorAll("td");
          return cells[4]?.textContent?.trim() === "Inactive";
        }).length,
      );

  const defaultInactiveCount = await countInactiveRosterRows();
  if (defaultInactiveCount > 0) {
    throw new Error(
      `Default roster must hide inactive users — found ${defaultInactiveCount} Inactive row(s).`,
    );
  }
  console.log("PASS: default roster excludes inactive users");

  await assertReadableTextContrast(page, TECHNICIAN_PANEL_CONTRAST_SPEC);
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="technician-settings-panel"]',
    elements: [
      {
        name: "archived users button (default)",
        selector: '[data-testid="pin-access-archived-button"]',
        large: false,
      },
    ],
  });
  await assertNoElementOverlap(page, {
    containerSelector: '[data-testid="technician-settings-panel"]',
    elementSelectors: [
      {
        name: "PIN access heading",
        selector: '[data-testid="pin-access-heading"]',
      },
      {
        name: "Archived Users button",
        selector: '[data-testid="pin-access-archived-button"]',
      },
      {
        name: "Add Access button",
        selector: '[data-testid="pin-access-add-button"]',
      },
    ],
  });

  // Visit-scoped "PIN # updated" badge must not appear until a confirmed PIN save.
  if ((await page.locator('[data-testid^="pin-access-pin-updated-"]').count()) !== 0) {
    throw new Error(
      "PIN # updated badge must not appear before a confirmed PIN save.",
    );
  }

  // D-42: inject Sol-approved success badge styles into actions cell for contrast.
  const actions = page.locator('[data-testid^="pin-access-actions-"]').first();
  await actions.waitFor({ timeout: 10_000 });
  await actions.evaluate((node) => {
    const span = document.createElement("span");
    span.setAttribute("data-testid", "pin-access-pin-updated-contrast-probe");
    span.textContent = "PIN # updated";
    span.style.display = "inline-flex";
    span.style.alignItems = "center";
    span.style.boxSizing = "border-box";
    span.style.flex = "0 0 auto";
    span.style.minHeight = "32px";
    span.style.padding = "6px 10px";
    span.style.borderRadius = "6px";
    span.style.border = "1px solid var(--admin-success-border)";
    span.style.backgroundColor = "var(--admin-success-bg)";
    span.style.color = "var(--admin-success-text)";
    span.style.fontSize = "13px";
    span.style.fontWeight = "700";
    span.style.lineHeight = "1.2";
    span.style.whiteSpace = "nowrap";
    node.appendChild(span);
  });
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="pin-access-management-panel"]',
    elements: [
      {
        name: "PIN # updated badge",
        selector: '[data-testid="pin-access-pin-updated-contrast-probe"]',
        minRatio: MIN_TEXT_CONTRAST,
      },
    ],
  });
  await page
    .getByTestId("pin-access-pin-updated-contrast-probe")
    .evaluate((el) => el.remove());

  await page.getByTestId("pin-access-archived-button").click();
  await page.waitForTimeout(400);

  const archivedEmpty = page.getByTestId("pin-access-archived-empty");
  const archivedInactiveCount = await countInactiveRosterRows();
  if ((await archivedEmpty.count()) > 0) {
    console.log("PASS: archived view empty state (no inactive users)");
  } else if (archivedInactiveCount > 0) {
    console.log(
      `PASS: archived view shows ${archivedInactiveCount} inactive row(s)`,
    );
  } else {
    throw new Error(
      "Archived view must show inactive rows or pin-access-archived-empty — neither found.",
    );
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="technician-settings-panel"]',
    elements: [
      {
        name: "archived users button (selected)",
        selector: '[data-testid="pin-access-archived-button"]',
        large: false,
      },
    ],
  });

  await page.getByTestId("pin-access-archived-button").click();
  await page.waitForTimeout(300);
  const backInactiveCount = await countInactiveRosterRows();
  if (backInactiveCount > 0) {
    throw new Error(
      "Active roster must hide inactive users after returning from archived view.",
    );
  }

  await page.screenshot({
    path: resolve(outDir, "settings-technicians-panel.png"),
  });

  console.log(
    `PASS: PIN & Access Management technician roster/detail verified with text contrast (≥${MIN_TEXT_CONTRAST}:1 normal, ≥${MIN_LARGE_TEXT_CONTRAST}:1 large), archived toggle, and no header overlap.`,
  );
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
