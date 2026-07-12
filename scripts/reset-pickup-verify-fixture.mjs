/**
 * Resets delivery-3 to pickup-eligible state for repeatable verify runs.
 * Uses authenticated dispatcher UI (no Admin SDK / ADC required).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run reset:pickup-verify
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assignStagingIfUnassigned,
  clickMarkStatus,
  clickRevertIfVisible,
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const isProd = /lgarage\.github\.io\/stageverify/i.test(baseUrl);
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";
const orderNumber = process.env.STAGEVERIFY_PICKUP_ORDER ?? "ORD-004";
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

loadEnvLocal();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  // Prod hides seed demo rows (ORD-001..006) — deep-link only (gotcha hideSeedDemoRows).
  if (isProd) {
    console.log(
      `Prod reset: deep-link drawer for ${deliveryId} (demo rows hidden on gh-pages).`,
    );
    await openDeliveryDrawerByDeepLink(page, appBase, deliveryId);
  } else {
    await openDeliveryDrawer(page, orderNumber, deliveryId);
  }

  let reverted = 0;
  for (let i = 0; i < 8; i++) {
    if (!(await clickRevertIfVisible(page))) break;
    reverted++;
  }
  if (reverted > 0) {
    console.log(`Reset ${deliveryId}: reverted ${reverted} step(s) toward pickup-eligible.`);
  }

  let advanced = false;
  for (let i = 0; i < 8; i++) {
    if (await clickMarkStatus(page, /Mark Partial/i)) {
      console.log(`Reset ${deliveryId}: marked Partial for pickup portal.`);
      advanced = true;
      break;
    }
    if (await clickMarkStatus(page, /Mark Staged/i)) {
      console.log(`Reset ${deliveryId}: marked Staged for pickup portal.`);
      advanced = true;
      break;
    }
    if (
      (await clickMarkStatus(page, /Mark Received/i)) ||
      (await clickMarkStatus(page, /Mark Shipped/i))
    ) {
      continue;
    }
    break;
  }

  if (!advanced) {
    const body = await page.locator("body").innerText();
    if (/Partial|Staged|Complete/i.test(body) && !/Picked Up/i.test(body)) {
      console.log(`Reset ${deliveryId}: already pickup-eligible.`);
    } else if (/Picked Up/i.test(body)) {
      console.warn(
        `Reset ${deliveryId}: still Picked Up after revert — run dispatcher revert manually or increase revert passes.`,
      );
    } else {
      console.warn(
        `Reset ${deliveryId}: could not advance to pickup-eligible. Check drawer status.`,
      );
    }
  }

  if (await assignStagingIfUnassigned(page)) {
    console.log(`Reset ${deliveryId}: assigned staging location for pickup display.`);
  }

  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
