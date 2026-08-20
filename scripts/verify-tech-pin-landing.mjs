/**
 * Technician post-PIN released-jobs landing polish verify (390 iPhone viewport).
 * FE layout + D-42 contrast. Uses tech-polish-landing fixture PIN when present.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-tech-pin-landing.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const techPin = process.env.STAGEVERIFY_TECH_POLISH_PIN ?? "482915";
const techId = process.env.STAGEVERIFY_TECH_POLISH_ID ?? "tech-polish-landing";
const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const outDir = resolve(process.cwd(), "screenshots", "tech-pin-landing");
mkdirSync(outDir, { recursive: true });

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function ensureRelease() {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required");
  const app = initializeApp(firebaseConfig, `verify-tech-landing-${Date.now()}`);
  await signInWithEmailAndPassword(getAuth(app), email, password);
  const release = httpsCallable(getFunctions(app), "releaseJobsToTechnician");
  await release({ technicianId: techId, jobIds: [jobId], replace: true });
}

async function main() {
  await ensureRelease();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${appBase}/#/s?loc=G1&_t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByTestId("location-scan-pin-keypad").waitFor({ timeout: 20_000 });
    await enterPin(page, techPin.split(""));
    await page.getByTestId("technician-released-jobs").waitFor({ timeout: 45_000 });
    await page
      .getByTestId(`tech-released-job-${jobId}`)
      .waitFor({ timeout: 45_000 });
    record("tech-list lands after PIN", true);

    const spacing = await page.evaluate(() => {
      const root = document.querySelector(
        '[data-testid="technician-released-jobs"]',
      );
      const header = root?.querySelector("header");
      const main = root?.querySelector("main");
      const card = root?.querySelector('[data-testid^="tech-released-job-"]');
      const back = root?.querySelector("header button");
      const footerBack = [...(root?.querySelectorAll("button") ?? [])].find(
        (b) =>
          b.textContent?.includes("← Back") &&
          !header?.contains(b),
      );
      const cs = (el) => (el ? getComputedStyle(el) : null);
      return {
        headerPl: parseFloat(cs(header)?.paddingLeft ?? "0"),
        headerPt: parseFloat(cs(header)?.paddingTop ?? "0"),
        mainPl: parseFloat(cs(main)?.paddingLeft ?? "0"),
        cardPad: parseFloat(cs(card)?.paddingTop ?? "0"),
        cardMinH: parseFloat(cs(card)?.minHeight ?? "0"),
        backTop: back?.getBoundingClientRect().top ?? -1,
        backInHeader: Boolean(back && header?.contains(back)),
        hasFooterBack: Boolean(footerBack),
      };
    });

    const spacingOk =
      spacing.headerPl >= 15 &&
      spacing.headerPt >= 15 &&
      spacing.mainPl >= 15 &&
      spacing.cardPad >= 15 &&
      spacing.cardMinH >= 130 &&
      spacing.backTop >= 12 &&
      spacing.backInHeader &&
      !spacing.hasFooterBack;
    record(
      "safe spacing + header Back (no footer Back)",
      spacingOk,
      JSON.stringify(spacing),
    );

    const title = await page.getByRole("heading", { name: "Pick up today" }).isVisible();
    record("primary heading visible", title);

    const goToChip = await page
      .locator('[data-testid^="tech-released-job-"] .font-mono')
      .first()
      .isVisible()
      .catch(() => false);
    const awaiting = await page
      .getByText("Awaiting staging spot")
      .isVisible()
      .catch(() => false);
    record("destination presentation", goToChip || awaiting);

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="technician-released-jobs"]',
      elements: [
        {
          name: "title",
          selector: "h1",
          large: true,
        },
        {
          name: "helper",
          selector: "header p.text-sm, header .tech-released-jobs-title + p",
        },
        {
          name: "job name",
          selector: ".tech-released-jobs-job-name",
          large: true,
        },
        {
          name: "back",
          selector: "header button.tap-target",
        },
      ],
    });
    record("D-42 contrast", true);

    await page.screenshot({
      path: resolve(outDir, "verify-loaded.png"),
      fullPage: false,
    });

    await page.goBack();
    await page.getByRole("heading", { name: "Enter PIN", exact: true }).waitFor({
      timeout: 15_000,
    });
    const afterTechBack = await page.locator("body").innerText();
    record(
      "Safari Back from tech list returns to PIN",
      /Enter PIN/.test(afterTechBack) &&
        !/Select vendor or technician to continue/i.test(afterTechBack),
    );
    await page.goForward();
    await page.getByTestId("technician-released-jobs").waitFor({
      timeout: 15_000,
    });
    record("Safari Forward from PIN returns to tech list", true);

    await page.getByTestId(`tech-released-job-${jobId}`).click();
    await page.waitForURL(/#\/pickup\?/, { timeout: 20_000 });
    record("card opens pickup", true, page.url());
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
