/**
 * Playwright: vendor receive post-PIN must use Firestore REST (not SDK Listen).
 * Blocks SDK WebChannel; asserts REST document reads succeed on iPhone UA.
 *
 * Usage:
 *   node scripts/verify-vendor-ios-rest.mjs --base-url=https://lgarage.github.io/stageverify
 */

import { webkit } from "playwright";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

(async () => {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    isIOS: true,
    userAgent: IPHONE_UA,
  });
  const page = await context.newPage();

  let restCalls = 0;
  let sdkListenBlocked = 0;

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("google.firestore.v1.Firestore/Listen")) {
      sdkListenBlocked += 1;
      return route.abort();
    }
    if (
      url.includes("firestore.googleapis.com/v1/projects/") &&
      (url.includes("/documents/deliveries/") ||
        url.includes("/documents:runQuery"))
    ) {
      restCalls += 1;
    }
    return route.continue();
  });

  const url = `${baseUrl.replace(/\/$/, "")}/#/receive?id=${deliveryId}`;
  console.log(`Opening ${url} (iPhone UA, SDK Listen blocked)`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });

  for (const digit of "1234") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }

  await page.waitForSelector("text=ORD-005", { timeout: 20_000 });
  await page.waitForSelector("text=Filter rack", { timeout: 10_000 });

  console.log(`  REST calls observed: ${restCalls}`);
  console.log(`  SDK Listen blocked: ${sdkListenBlocked}`);

  if (restCalls < 2) {
    throw new Error(
      `Expected ≥2 Firestore REST calls (delivery + items), got ${restCalls}`,
    );
  }
  if (sdkListenBlocked < 1) {
    console.warn(
      "WARN: No SDK Listen attempts blocked — SDK may not have been used (OK if REST-only)",
    );
  }

  console.log("PASS: Vendor receive post-PIN via Firestore REST on iPhone UA.");
  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
