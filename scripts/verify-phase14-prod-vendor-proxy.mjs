/**
 * §14 prod vendor proxy (steps 3–7) when STAGEVERIFY_* vendor env is unset.
 *
 * Asserts prod gh-pages dispatcher shows a real delivered invoice row (4046362).
 * Full vendor receive requires STAGEVERIFY_RECEIVE_DELIVERY + vendor env — see
 * verify-vendor-delivered.mjs.
 */

import { chromium } from "playwright";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  assertDeliveredOverviewTiles,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const searchTerm =
  process.env.STAGEVERIFY_VERIFY_ORDER?.trim() ?? "4046362";

if (!/lgarage\.github\.io\/stageverify/i.test(baseUrl)) {
  console.error(
    "verify-phase14-prod-vendor-proxy is for prod gh-pages only — use verify-vendor-delivered locally.",
  );
  process.exit(1);
}

loadEnvLocal();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await ensureAuthenticated(page, appBase);
  await assertDeliveredOverviewTiles(page, searchTerm);
  console.log(
    `PASS: prod dispatcher delivered overview for "${searchTerm}" (vendor proxy steps 3–7).`,
  );
  await browser.close();
  process.exit(0);
} catch (err) {
  await browser.close();
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
