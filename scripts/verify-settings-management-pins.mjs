/**
 * Settings → Management PINs capability matrix (D-49).
 * Requires STAGEVERIFY_TEST_EMAIL / PASSWORD + playwright auth or live login.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

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
const appBase = resolveAppBase(baseUrl);
const outDir = resolve(process.cwd(), "screenshots", "settings-management-pins");
mkdirSync(outDir, { recursive: true });

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required");
  }
  console.log(`Settings management PINs verify — ${appBase}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(`${appBase}/#/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(/#\/(dispatcher|settings|portal)/, { timeout: 45_000 }).catch(() => {});

    await page.goto(`${appBase}/#/settings`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByTestId("management-settings-panel").waitFor({ timeout: 30_000 });
    record("management settings panel visible", true);

    await page.getByTestId("mgmt-pins-section").waitFor({ timeout: 15_000 });
    record("management PINs section visible", true);

    for (const key of [
      "enterPortalAnyQr",
      "catchAllCheckIn",
      "viewWaitingParts",
      "markOrFlagParcel",
    ]) {
      await page.getByTestId(`mgmt-pin-new-cap-${key}`).waitFor({ timeout: 10_000 });
    }
    record("create-PIN capability checkboxes present", true);

    await assertReadableTextContrast(page, {
      rootSelector: "[data-testid='management-settings-panel']",
      elements: [
        { name: "pins heading", selector: "[data-testid='mgmt-pins-section'] h3" },
        {
          name: "create section label",
          selector: "[data-testid='mgmt-pin-create'] p",
        },
      ],
    });
    record("D-42 readable text contrast", true);

    await page.screenshot({
      path: resolve(outDir, "01-management-pins.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`FAILED ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`All ${results.length} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
