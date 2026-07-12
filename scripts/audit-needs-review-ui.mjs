/**
 * Read-only audit: Needs Review matched vs unmatched UI on prod/local.
 * Usage:
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify node scripts/audit-needs-review-ui.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots/needs-review-audit");
loadEnvLocal();
mkdirSync(outDir, { recursive: true });

const report = { baseUrl, items: [], stripCollapsed: null, errors: [] };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  await page.getByRole("heading", { name: "Delivery Overview" }).waitFor({ timeout: 30_000 });

  const strip = page.getByTestId("needs-review-email-strip");
  await strip.waitFor({ timeout: 20_000 });
  report.stripCollapsed = (await page.getByTestId("needs-review-email-count").innerText()).trim();
  await page.screenshot({ path: resolve(outDir, "01-collapsed.png"), fullPage: false });

  const toggle = page.getByTestId("needs-review-email-toggle");
  if (!(await toggle.count())) {
    report.errors.push("No toggle — zero-item strip?");
    writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  await toggle.click();
  await page.getByTestId("needs-review-email-list").waitFor({ timeout: 15_000 });
  await page.screenshot({ path: resolve(outDir, "02-expanded-all.png"), fullPage: false });

  const items = page.locator('[data-testid^="needs-review-email-item-"]');
  const count = await items.count();
  report.itemCount = count;

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const itemTestId = await item.getAttribute("data-testid");
    const messageId = itemTestId?.replace("needs-review-email-item-", "") ?? `idx-${i}`;
    const tier = await item.getAttribute("data-review-tier");
    const reason = await page.getByTestId(`needs-review-email-reason-${messageId}`).innerText();
    const secondary = await page.getByTestId(`needs-review-email-secondary-${messageId}`).innerText();
    const preview = await page.getByTestId(`needs-review-email-excerpt-${messageId}`).innerText();
    const previewBlock = await page.getByTestId(`needs-review-email-preview-${messageId}`).innerText();

    const entry = {
      messageId,
      tier,
      reason: reason.trim(),
      secondary: secondary.trim(),
      excerpt: preview.trim().slice(0, 200),
      previewBlock: previewBlock.trim().slice(0, 400),
      suspiciousInReason: /Suspicious/i.test(reason),
      matchedThreadCopy: /Matched to an existing StageVerify email thread/i.test(secondary),
      showOriginalWorks: false,
      hideOriginalWorks: false,
    };

    const showBtn = page.getByTestId(`needs-review-view-original-${messageId}`);
    const btnBefore = (await showBtn.innerText()).trim();
    if (btnBefore === "Show Original Email") {
      await showBtn.click();
      await page.getByTestId(`needs-review-original-${messageId}`).waitFor({ timeout: 10_000 });
      entry.showOriginalWorks = true;
      const originalText = await page.getByTestId(`needs-review-original-${messageId}`).innerText();
      entry.originalPreview = originalText.trim().slice(0, 300);
      entry.hasToken92f1db5a = /92f1db5a/i.test(originalText);
      entry.hasControlledReplyTest = /controlled-reply-test-1/i.test(originalText);
      await page.screenshot({
        path: resolve(outDir, `03-${tier ?? "unknown"}-${i}-original-open.png`),
        fullPage: false,
      });
      const btnAfter = (await showBtn.innerText()).trim();
      entry.hideOriginalWorks = btnAfter === "Hide Original Email";
      await showBtn.click();
    }

    await item.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(outDir, `03-${tier ?? "unknown"}-${i}-collapsed-original.png`),
      fullPage: false,
    });

    report.items.push(entry);
  }

  writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  console.log(`Screenshots: ${outDir}`);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
