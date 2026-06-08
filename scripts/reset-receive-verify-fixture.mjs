/**
 * Resets delivery-3 to receive-eligible state after pickup verify runs.
 * Reverts picked_up / staged back to arrived when needed.
 *
 * Usage:
 *   npm run dev
 *   npm run reset:receive-verify
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  clickRevertIfVisible,
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const deliveryId = process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-3";
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

  let reverted = 0;
  for (let i = 0; i < 4; i++) {
    const text = await page.locator("body").innerText();
    if (/Picked Up/i.test(text)) {
      if (await clickRevertIfVisible(page)) {
        reverted++;
        continue;
      }
    }
    if (/Staged/i.test(text) && !/Partial/i.test(text.split("Current Status")[1] ?? "")) {
      if (await clickRevertIfVisible(page)) {
        reverted++;
        continue;
      }
    }
    if (/Partial/i.test(text.split("Current Status")[1] ?? "")) {
      if (await clickRevertIfVisible(page)) {
        reverted++;
        continue;
      }
    }
    break;
  }

  const finalText = await page.locator("body").innerText();
  if (/Received/i.test(finalText) || /Partial/i.test(finalText)) {
    console.log(
      `Reset ${deliveryId} for receive: ${reverted} revert(s); status receive-eligible.`,
    );
  } else {
    console.warn(
      `Reset ${deliveryId}: may not be receive-eligible. Drawer text snippet:\n${finalText.slice(0, 400)}`,
    );
  }

  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
