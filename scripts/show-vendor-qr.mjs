/**
 * Screenshot vendor demo QR page for iPhone scan testing + open in browser.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ??
  "https://lgarage.github.io/stageverify";
const url = `${baseUrl.replace(/\/$/, "")}/#/demo/vendor-scan`;
const outDir = resolve(process.cwd(), "screenshots", "vendor-demo");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "qr-for-phone.png");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForSelector("text=Vendor receive demo", { timeout: 30_000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`QR screenshot: ${outPath}`);
console.log(`Scan URL: ${url}`);
console.log("PIN: 1234 (ORD-005)");

if (process.platform === "win32") {
  execSync(`cmd /c start ${url}`, { stdio: "ignore" });
}
