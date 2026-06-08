import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

export async function ensureAuthenticated(page, appBase) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);
  if (!page.url().includes("/login")) return;

  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(dispatcher|settings|hub|zones|vendors)/, {
    timeout: 20_000,
  });
}

export async function openDeliveryDrawer(page, orderNumber, deliveryId) {
  const drawerOpen = await page
    .getByText("Current Status", { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (drawerOpen) return;

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("");
  await search.fill(orderNumber);
  await page.waitForTimeout(1500);

  const badge = page.getByTestId(`open-issue-badge-${deliveryId}`);
  const row = page.locator("tr").filter({ has: badge }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
  } else {
    await page.locator("button").filter({ hasText: /^View$/ }).first().click();
  }
  await page.waitForTimeout(1500);
}

export async function clickRevertIfVisible(page) {
  const revertBtn = page.getByRole("button", { name: /Revert to/i });
  if (!(await revertBtn.isVisible().catch(() => false))) return false;
  await revertBtn.click();
  await page.waitForTimeout(2000);
  return true;
}

export async function clickMarkStatus(page, labelPattern) {
  const btn = page.getByRole("button", { name: labelPattern });
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.click();
  await page.waitForTimeout(2000);
  return true;
}
