/**
 * PR loop classifier — mechanical path → tier → verifier route (Fable design #1).
 * SSOT: ship-loop.mdc two-tier, model-gates Ship Verifier path rules.
 */

/** @typedef {"tier0-only" | "grok-pr-verifier" | "sonnet-then-grok-pr-verifier" | "fable-pr-verifier" | "blocked"} VerifierRoute */

/** @typedef {{
 *   path: string;
 *   reason: string;
 *   category: "high-risk" | "security-surface" | "substantive" | "fast-safe" | "excluded";
 * }} ClassifiedPath */

const HIGH_RISK_RULES = [
  { test: (p) => p === "firestore.rules", reason: "firestore.rules any diff" },
  { test: (p) => p.startsWith("functions/"), reason: "functions/** (CF deploy surface)" },
  { test: (p) => p === "firebase.json", reason: "firebase config" },
  { test: (p) => p.startsWith(".github/workflows/"), reason: "CI/workflows secrets" },
];

const SECURITY_SURFACE_RULES = [
  { test: (p) => p === "firestore.rules", reason: "firestore.rules" },
  { test: (p) => p.startsWith("functions/src/"), reason: "Cloud Functions writes" },
  { test: (p) => p.startsWith("functions/"), reason: "functions package" },
  { test: (p) => /auth|session|token|login|pin/i.test(p) && p.startsWith("src/"), reason: "auth/session/token/login in src/" },
  { test: (p) => /VendorPinGate|verifyTechnicianPin|verifyVendorPin/i.test(p), reason: "PIN/auth surface" },
  { test: (p) => p === "firebase.json", reason: "firebase config" },
];

const SHIP_VERIFIER_SUBSTANTIVE = [
  { test: (p) => p.startsWith("src/"), reason: "frontend bundle" },
  { test: (p) => p.startsWith("functions/src/"), reason: "CF source" },
  { test: (p) => p.startsWith("public/"), reason: "static assets" },
  { test: (p) => p === "index.html", reason: "entry HTML" },
  {
    test: (p) =>
      p.startsWith("scripts/") &&
      /^scripts\/verify-[^/]+\.mjs$/.test(p),
    reason: "behavior-bearing verify script",
  },
];

const SHIP_VERIFIER_EXCLUDED = [
  { test: (p) => p.startsWith("docs/"), reason: "docs only" },
  { test: (p) => p.startsWith("PROJECT_STATUS/"), reason: "PROJECT_STATUS only" },
  { test: (p) => p.startsWith(".cursor/"), reason: "rules only" },
  { test: (p) => p === "README.md" || p.startsWith("README"), reason: "README only" },
  {
    test: (p) => p.startsWith("functions/lib/"),
    reason: "compiled functions/lib sync-only",
  },
];

const HIGH_RISK_KEYWORDS = [
  "firestore.rules",
  "functions/",
  "firebase deploy",
  "firestore:rules",
  "functions:rules",
  "gmail watch",
  "pubsub",
  "pub/sub",
  "migration",
  "schema migration",
  "data deletion",
  "secrets",
  "GMAIL_PUBSUB",
];

/** File/path → local + prod verify npm scripts */
const VERIFY_SCRIPT_MAP = [
  {
    match: (p) =>
      /DispatcherDashboardPage|deliveryDisplayHelpers|dispatcher\//i.test(p),
    local: ["verify:dispatcher-nav", "verify:delivery-consistency"],
    prod: ["verify:dispatcher-nav:prod", "verify:delivery-consistency:prod"],
  },
  {
    match: (p) =>
      /verify-location-phase4|VendorNeedMoreSpaceFlow|planned-staging|LocationScanPage/i.test(
        p,
      ),
    local: ["verify:location-phase4"],
    prod: ["verify:location-phase4:prod"],
  },
  {
    match: (p) => /PickupPortalPage|verify-pickup-portal/i.test(p),
    local: ["verify:pickup"],
    prod: ["verify:pickup:prod"],
  },
  {
    match: (p) => /ReceivingPage|verify-receive|verify-vendor-delivered/i.test(p),
    local: ["verify:vendor-delivered", "verify:receive"],
    prod: ["verify:vendor-delivered:prod", "verify:receive:prod"],
  },
  {
    match: (p) => /SettingsPage|verify-settings-staging/i.test(p),
    local: ["verify:settings-staging"],
    prod: ["verify:settings-staging:prod"],
  },
  {
    match: (p) => /ZoneManagementPage|verify-location-scan/i.test(p),
    local: ["verify:location-scan"],
    prod: ["verify:location-scan:prod"],
  },
  {
    match: (p) => /InvoiceReview|verify-invoice-review/i.test(p),
    local: ["verify:invoice-review"],
    prod: ["verify:invoice-review:prod"],
  },
  {
    match: (p) => /verify-privacy|privacy-negative/i.test(p),
    local: ["verify:privacy"],
    prod: ["verify:privacy:prod"],
  },
  {
    match: (p) => p === "package.json" || p.startsWith("scripts/verify-"),
    local: ["verify:cloud-env"],
    prod: [],
  },
];

const EMULATOR_TEST_MAP = [
  {
    match: (p) => p.startsWith("functions/src/"),
    tests: ["test:pickup-authority", "test:mark-vendor-delivered"],
  },
];

/**
 * @param {string} filePath
 * @returns {ClassifiedPath}
 */
export function classifyPath(filePath) {
  const path = filePath.replace(/\\/g, "/").replace(/^\.\//, "");

  for (const rule of HIGH_RISK_RULES) {
    if (rule.test(path)) {
      return { path, reason: rule.reason, category: "high-risk" };
    }
  }

  if (path === "package.json") {
    return {
      path,
      reason: "root package.json — inspect scripts section at drain",
      category: "fast-safe",
    };
  }

  for (const rule of SECURITY_SURFACE_RULES) {
    if (rule.test(path)) {
      return { path, reason: rule.reason, category: "security-surface" };
    }
  }

  for (const rule of SHIP_VERIFIER_EXCLUDED) {
    if (rule.test(path)) {
      return { path, reason: rule.reason, category: "excluded" };
    }
  }

  for (const rule of SHIP_VERIFIER_SUBSTANTIVE) {
    if (rule.test(path)) {
      return { path, reason: rule.reason, category: "substantive" };
    }
  }

  if (path.startsWith("src/") || path.startsWith("public/") || path.startsWith("scripts/")) {
    return { path, reason: "fast-safe path prefix", category: "fast-safe" };
  }

  return { path, reason: "unclassified — treat as fast-safe until reviewed", category: "fast-safe" };
}

/**
 * @param {string[]} changedFiles
 * @param {{ danApproved?: boolean; scopeText?: string }} [options]
 */
export function classifyPrDiff(changedFiles, options = {}) {
  const classified = changedFiles.map(classifyPath);
  const highRisk = classified.filter((c) => c.category === "high-risk");
  const security = classified.filter((c) => c.category === "security-surface");
  const substantive = classified.filter((c) => c.category === "substantive");
  const excluded = classified.filter((c) => c.category === "excluded");
  const fastSafe = classified.filter(
    (c) => c.category === "fast-safe" || c.category === "substantive",
  );

  const scopeText = options.scopeText ?? "";
  const keywordHits = HIGH_RISK_KEYWORDS.filter((kw) =>
    scopeText.toLowerCase().includes(kw.toLowerCase()),
  );

  const hasHighRisk = highRisk.length > 0 || security.length > 0;
  const danApproved = options.danApproved === true;

  let blocked = false;
  let blockReason = null;

  if (hasHighRisk && !danApproved) {
    blocked = true;
    blockReason =
      "High-risk or security-surface paths without danApproved — block repair loop per D-01/D-07";
  }

  const onlyExcluded =
    classified.length > 0 &&
    excluded.length === classified.length;

  const substantiveShip = substantive.length > 0;
  const securitySurface = classified.some(
    (c) =>
      c.category === "security-surface" ||
      (c.category === "high-risk" &&
        (c.path.startsWith("functions/") || c.path === "firestore.rules")),
  );

  /** @type {VerifierRoute} */
  let verifierRoute = "tier0-only";

  if (blocked) {
    verifierRoute = "blocked";
  } else if (onlyExcluded) {
    verifierRoute = "tier0-only";
  } else if (securitySurface) {
    verifierRoute = "sonnet-then-grok-pr-verifier";
  } else if (substantiveShip) {
    verifierRoute = "grok-pr-verifier";
  } else if (classified.length === 0) {
    verifierRoute = "tier0-only";
  }

  const tier =
    hasHighRisk && !danApproved
      ? "high-risk"
      : hasHighRisk && danApproved
        ? "high-risk-approved"
        : substantiveShip
          ? "fast-safe-substantive"
          : "fast-safe";

  const localVerify = new Set(["npm run build", "npm run away:validate"]);
  const prodVerify = new Set();
  const emulatorTests = new Set();

  for (const file of changedFiles) {
    for (const row of VERIFY_SCRIPT_MAP) {
      if (!row.match(file)) continue;
      for (const s of row.local) localVerify.add(`npm run ${s}`);
      for (const s of row.prod) prodVerify.add(`npm run ${s}`);
    }
    for (const row of EMULATOR_TEST_MAP) {
      if (!row.match(file)) continue;
      for (const t of row.tests) emulatorTests.add(`npm run ${t}`);
    }
  }

  if (substantiveShip && localVerify.size <= 2) {
    localVerify.add("npm run verify:dispatcher-nav");
  }

  return {
    changedFiles,
    classified,
    summary: {
      tier,
      blocked,
      blockReason,
      highRiskPaths: [...highRisk, ...security].map((c) => ({
        path: c.path,
        reason: c.reason,
      })),
      fastSafePaths: fastSafe.map((c) => c.path),
      securitySurface,
      substantiveShip,
      shipVerifierExcluded: onlyExcluded,
      scopeKeywordHits: keywordHits,
      danApproved,
    },
    verifierRoute,
    tier0: {
      build: "npm run build",
      validate: "npm run away:validate",
      verifyScripts: [...localVerify].filter((s) => !s.includes("away:validate") && !s.includes("build")),
      checks: [...localVerify],
      emulatorTests: [...emulatorTests],
    },
    prodVerifyDeferred: [...prodVerify],
    loop: {
      maxFixCycles: 3,
      terminalPass: "ready-for-dan-merge",
      terminalFail: "blocked",
      orchestrator: "composer-2.5-parent",
      steps: [
        "CLASSIFY",
        "TIER0",
        "VERIFIER",
        "COMPOSER_FIX",
        "RE_VERIFY",
      ],
      note: "Verifier Tasks are readonly — parent Composer implements fixes and re-dispatches same verifier (fix-closure D-04/D-20).",
    },
    autonomy: {
      loopAllowed: !blocked,
      mergeAllowed: false,
      deployAllowed: false,
      prodVerifyPreMerge: false,
      agentMayCommitToBranch: !blocked,
    },
  };
}

/** Self-test fixtures for --assert */
export const CLASSIFIER_FIXTURES = [
  {
    name: "docs-only excluded",
    files: ["docs/roadmap.md", "PROJECT_STATUS/CURRENT_STATE.md"],
    expect: { verifierRoute: "tier0-only", blocked: false },
  },
  {
    name: "src substantive grok",
    files: ["src/DispatcherDashboardPage.tsx"],
    expect: { verifierRoute: "grok-pr-verifier", blocked: false },
  },
  {
    name: "firestore.rules blocked without approval",
    files: ["firestore.rules"],
    expect: { verifierRoute: "blocked", blocked: true },
  },
  {
    name: "functions security blocked without approval",
    files: ["functions/src/index.ts"],
    expect: { verifierRoute: "blocked", blocked: true },
  },
  {
    name: "functions approved",
    files: ["functions/src/pickup.ts"],
    danApproved: true,
    expect: { verifierRoute: "sonnet-then-grok-pr-verifier", blocked: false },
  },
  {
    name: "location-phase4 maps verify script",
    files: ["scripts/verify-location-phase4.mjs", "src/DispatcherDashboardPage.tsx"],
    expect: {
      verifierRoute: "grok-pr-verifier",
      includesVerify: "verify:location-phase4",
    },
  },
];

/**
 * @param {typeof CLASSIFIER_FIXTURES[number]} fixture
 */
export function assertFixture(fixture) {
  const result = classifyPrDiff(fixture.files, {
    danApproved: fixture.danApproved,
    scopeText: fixture.scopeText ?? "",
  });
  const errors = [];

  if (result.verifierRoute !== fixture.expect.verifierRoute) {
    errors.push(
      `verifierRoute: got ${result.verifierRoute}, want ${fixture.expect.verifierRoute}`,
    );
  }
  if (fixture.expect.blocked !== undefined && result.summary.blocked !== fixture.expect.blocked) {
    errors.push(`blocked: got ${result.summary.blocked}, want ${fixture.expect.blocked}`);
  }
  if (fixture.expect.includesVerify) {
    const all = [
      ...result.tier0.verifyScripts,
      ...result.prodVerifyDeferred,
    ].join(" ");
    if (!all.includes(fixture.expect.includesVerify)) {
      errors.push(`missing verify mapping for ${fixture.expect.includesVerify}`);
    }
  }

  return { pass: errors.length === 0, errors, result };
}
