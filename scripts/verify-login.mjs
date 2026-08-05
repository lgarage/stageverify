/**
 * Playwright: dispatcher login + forgot-password flow (D-60, auth-native).
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:login
 *   npm run verify:login:prod
 */

import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
} from "./lib/ui-text-contrast-lib.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const appBase = resolveAppBase(baseUrl);

const FORGOT_SUCCESS_MESSAGE =
  "If that email is registered, a reset link has been sent.";

const ENUMERATION_LEAKS = [
  /user not found/i,
  /no account/i,
  /not registered/i,
  /does not exist/i,
];

const LOGIN_CONTRAST_SPEC = {
  rootSelector: '[data-testid="login-page"]',
  elements: [
    { name: "title", selector: "h1", large: true },
    { name: "subtitle", selector: "p.mt-2", large: false },
    { name: "email label", selector: 'label[for="email"]', large: false },
    { name: "password label", selector: 'label[for="password"]', large: false },
    {
      name: "forgot link",
      selector: '[data-testid="forgot-password-link"]',
      large: false,
    },
    { name: "sign in button", selector: 'button[type="submit"]', large: true },
  ],
};

const FORGOT_CONTRAST_SPEC = {
  rootSelector: '[data-testid="forgot-password-form"]',
  elements: [
    {
      name: "forgot intro",
      selector: '[data-testid="forgot-password-form"] > p',
      large: false,
    },
    {
      name: "forgot email label",
      selector: 'label[for="forgot-email"]',
      large: false,
    },
    {
      name: "send reset button",
      selector: '[data-testid="forgot-password-submit"]',
      large: true,
    },
    {
      name: "contact admin",
      selector: '[data-testid="forgot-password-form"] .text-xs',
      large: false,
    },
    {
      name: "back link",
      selector: '[data-testid="back-to-login"]',
      large: false,
    },
  ],
};

const DONE_CONTRAST_SPEC = {
  rootSelector: '[data-testid="forgot-password-done"]',
  elements: [
    {
      name: "success message",
      selector: '[data-testid="forgot-password-success"]',
      large: false,
    },
    {
      name: "back link done",
      selector: '[data-testid="back-to-login-done"]',
      large: false,
    },
  ],
};

function pass(step, detail = "") {
  console.log(`PASS: ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step, detail = "") {
  console.log(`FAIL: ${step}${detail ? ` — ${detail}` : ""}`);
  throw new Error(`${step}${detail ? `: ${detail}` : ""}`);
}

function assert(step, ok, detail = "") {
  if (ok) pass(step, detail);
  else fail(step, detail);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  console.log(`\n=== verify:login @ ${appBase}/#/login ===\n`);

  await page.goto(`${appBase}/#/login`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector('[data-testid="login-page"]', { timeout: 15_000 });
  pass("login page loads");

  assert(
    "login URL hash",
    page.url().includes("/login") || page.url().includes("#/login"),
    page.url(),
  );

  await assertReadableTextContrast(page, LOGIN_CONTRAST_SPEC);
  pass("D-42 contrast — login view");

  const forgotLink = page.locator('[data-testid="forgot-password-link"]');
  assert("forgot password link visible", await forgotLink.isVisible());
  await forgotLink.click();

  await page.waitForSelector('[data-testid="forgot-password-form"]', {
    timeout: 10_000,
  });
  pass("forgot password form shown");

  await assertReadableTextContrast(page, FORGOT_CONTRAST_SPEC);
  pass("D-42 contrast — forgot view");

  const adminHint = page.getByText("Contact your admin");
  assert("contact admin hint visible", await adminHint.isVisible());

  await page.fill("#forgot-email", "not-a-real-user@example.com");
  await page.click('[data-testid="forgot-password-submit"]');

  await page.waitForSelector('[data-testid="forgot-password-done"]', {
    timeout: 20_000,
  });
  pass("forgot done view shown after submit");

  const successText = await page
    .locator('[data-testid="forgot-password-success"]')
    .textContent();
  assert(
    "unified anti-enumeration message",
    successText?.trim() === FORGOT_SUCCESS_MESSAGE,
    successText ?? "",
  );

  const bodyText = await page.locator("body").innerText();
  for (const leak of ENUMERATION_LEAKS) {
    assert(`no enumeration leak (${leak})`, !leak.test(bodyText));
  }

  await assertReadableTextContrast(page, DONE_CONTRAST_SPEC);
  pass("D-42 contrast — done view");

  await page.click('[data-testid="back-to-login-done"]');
  await page.waitForSelector("#email", { timeout: 10_000 });
  pass("back to sign in from done view");

  await page.click('[data-testid="forgot-password-link"]');
  await page.waitForSelector('[data-testid="forgot-password-form"]');
  await page.click('[data-testid="back-to-login"]');
  await page.waitForSelector("#password", { timeout: 10_000 });
  pass("back to sign in from forgot form");

  await browser.close();
  console.log("\nverify:login PASS\n");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
