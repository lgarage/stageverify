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
  clickMarkStatus,
  clickRevertIfVisible,
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
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
  await openDeliveryDrawer(page, orderNumber, deliveryId);

  if (await clickRevertIfVisible(page)) {
    console.log(`Reset ${deliveryId}: reverted one step toward pickup-eligible.`);
  }

  if (await clickMarkStatus(page, /Mark Partial/i)) {
    console.log(`Reset ${deliveryId}: marked Partial for pickup portal.`);
  } else if (await clickMarkStatus(page, /Mark Staged/i)) {
    console.log(`Reset ${deliveryId}: marked Staged for pickup portal.`);
  } else if (await page.getByRole("button", { name: /Revert to/i }).isVisible().catch(() => false)) {
    console.log(`Reset ${deliveryId}: pickup-eligible (partial/staged/complete).`);
  } else {
    console.log(`Reset ${deliveryId}: no status action needed — may already be pickup-eligible.`);
  }

  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
