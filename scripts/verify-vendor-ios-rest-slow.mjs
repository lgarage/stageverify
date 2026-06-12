/**
 * iPhone-like: WebKit + iPhone UA + artificial latency + SDK Listen blocked.
 * WebKit has no CDP throttling — adds ~300ms per request to simulate cellular RTT.
 */

import { webkit } from "playwright";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "https://lgarage.github.io/stageverify";

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

const LATENCY_MS = 300;

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

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("google.firestore.v1.Firestore/Listen")) {
      return route.abort();
    }
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    return route.continue();
  });

  const url = `${baseUrl.replace(/\/$/, "")}/#/receive?id=${deliveryId}`;
  console.log(
    `WebKit iPhone UA + ${LATENCY_MS}ms/request latency + SDK blocked: ${url}`,
  );
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 45_000 });

  const t0 = Date.now();
  for (const digit of "1234") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }

  await page.waitForSelector("text=ORD-005", { timeout: 25_000 });
  const elapsed = Date.now() - t0;
  console.log(`  PIN → ORD-005 (latency sim): ${elapsed}ms`);

  if (await page.locator("text=Delivery load timed out").isVisible()) {
    throw new Error("Timeout UI visible after PIN under latency simulation");
  }

  if (elapsed > 15000) {
    throw new Error(`Post-PIN load exceeded 15s: ${elapsed}ms`);
  }

  console.log("PASS: Latency-simulated iPhone WebKit — post-PIN load OK.");
  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
