#!/usr/bin/env node
/**
 * Unit tests for scripts/gate-check.mjs
 * Run: npm run gate:check:test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SECURITY_GATE_ID_RE,
  ALLOWED_GATE_MODELS,
  REQUIRED_MODEL_LINE,
  MISSING_MODEL_LINE_HINT,
  MISSING_SECURITY_GATE_ID_HINT,
  hasAllowedGateModel,
  extractSecurityGateIdValue,
  hasValidSecurityGateId,
  classifyPath,
  packageJsonHighRisk,
  checkEvidence,
  resolveEvidence,
} from "./gate-check.mjs";

describe("classifyPath", () => {
  it("flags firestore.rules as high-risk", () => {
    assert.deepEqual(classifyPath("firestore.rules"), ["high-risk"]);
  });

  it("does not flag non-core-loop functions/src as high-risk (D-94 MEDIUM)", () => {
    const tags = classifyPath("functions/src/index.ts");
    assert.ok(!tags.includes("high-risk"));
    assert.ok(tags.includes("substantive-ship"));
  });

  it("flags core-loop write CFs as high-risk", () => {
    for (const p of [
      "functions/src/approveVendorInvoiceImport.ts",
      "functions/src/assignVendorStagingLocation.ts",
      "functions/src/reassignDeliveryStagingLocation.ts",
      "functions/src/markVendorDelivered.ts",
      "functions/src/markVendorDeliveriesBulk.ts",
      "functions/src/recordPickupEvent.ts",
      "functions/src/releasePlannedStagingLocation.ts",
    ]) {
      assert.ok(classifyPath(p).includes("high-risk"), p);
    }
  });

  it("flags PIN/auth CF files as high-risk", () => {
    assert.ok(classifyPath("functions/src/setAccessPin.ts").includes("high-risk"));
    assert.ok(classifyPath("functions/src/resolveLocationScanPin.ts").includes("high-risk"));
  });

  it("does not flag unrelated CF files as high-risk", () => {
    assert.ok(!classifyPath("functions/src/getVendorRunDeliveries.ts").includes("high-risk"));
    assert.ok(!classifyPath("functions/src/inboundEmail/sanitizeParsedLines.ts").includes("high-risk"));
  });

  it("flags gate-check and install-git-hooks as high-risk CI/gate config", () => {
    assert.ok(classifyPath("scripts/gate-check.mjs").includes("high-risk"));
    assert.ok(classifyPath("scripts/install-git-hooks.mjs").includes("high-risk"));
  });

  it("excludes functions/lib from high-risk", () => {
    const tags = classifyPath("functions/lib/index.js");
    assert.ok(tags.includes("excluded"));
    assert.ok(!tags.includes("high-risk"));
  });

  it("flags .github/workflows and firebase.json", () => {
    assert.ok(classifyPath(".github/workflows/ci.yml").includes("high-risk"));
    assert.ok(classifyPath("firebase.json").includes("high-risk"));
  });

  it("hits src auth heuristic including pin/role", () => {
    assert.ok(classifyPath("src/auth/login.tsx").includes("high-risk"));
    assert.ok(classifyPath("src/dispatcher/sessionStore.ts").includes("high-risk"));
    assert.ok(classifyPath("src/vendor/VendorPinGate.tsx").includes("high-risk"));
  });

  it("misses src paths outside auth heuristic for high-risk", () => {
    const tags = classifyPath("src/components/Button.tsx");
    assert.ok(!tags.includes("high-risk"));
    assert.ok(tags.includes("substantive-ship"));
  });

  it("classifies scripts/*.mjs but not *.test.mjs", () => {
    assert.ok(classifyPath("scripts/verify-pickup.mjs").includes("substantive-ship"));
    assert.ok(!classifyPath("scripts/gate-check.test.mjs").includes("substantive-ship"));
  });

  it("marks excluded paths", () => {
    assert.ok(classifyPath("docs/foo.md").includes("excluded"));
    assert.ok(classifyPath("PROJECT_STATUS/CURRENT_STATE.md").includes("excluded"));
    assert.ok(classifyPath(".cursor/rules/foo.mdc").includes("excluded"));
    assert.ok(classifyPath("README.md").includes("excluded"));
    assert.ok(classifyPath("AGENTS.md").includes("excluded"));
  });

  it("classifies public and index.html as substantive-ship", () => {
    assert.ok(classifyPath("public/foo.png").includes("substantive-ship"));
    assert.ok(classifyPath("index.html").includes("substantive-ship"));
  });

  it("normalizes leading ./ prefixes before matching", () => {
    assert.deepEqual(classifyPath("./src/components/Button.tsx"), classifyPath("src/components/Button.tsx"));
    assert.ok(classifyPath("./firestore.rules").includes("high-risk"));
    assert.ok(classifyPath("././src/auth/login.tsx").includes("high-risk"));
    assert.ok(classifyPath("./docs/foo.md").includes("excluded"));
  });
});

describe("SECURITY_GATE_ID_RE", () => {
  it("accepts valid lowercase uuid", () => {
    const body = "security-gate-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    assert.ok(SECURITY_GATE_ID_RE.test(body));
  });

  it("accepts bc- prefixed lowercase uuid", () => {
    const body = "security-gate-id: bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d";
    assert.ok(SECURITY_GATE_ID_RE.test(body));
  });

  it("rejects uppercase uuid", () => {
    const body = "security-gate-id: A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    assert.ok(!SECURITY_GATE_ID_RE.test(body));
  });

  it("rejects uppercase bc- uuid", () => {
    const body = "security-gate-id: bc-A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    assert.ok(!SECURITY_GATE_ID_RE.test(body));
  });

  it("rejects short invalid id", () => {
    const body = "security-gate-id: deadbeef";
    assert.ok(!SECURITY_GATE_ID_RE.test(body));
  });
});

describe("extractSecurityGateIdValue / hasValidSecurityGateId", () => {
  const bareUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const bcUuid = "bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d";

  it("parses bare uuid", () => {
    assert.equal(extractSecurityGateIdValue(`security-gate-id: ${bareUuid}`), bareUuid);
    assert.equal(hasValidSecurityGateId(`security-gate-id: ${bareUuid}`), true);
  });

  it("parses bc- uuid without model", () => {
    assert.equal(extractSecurityGateIdValue(`security-gate-id: ${bcUuid}`), bcUuid);
    assert.equal(hasValidSecurityGateId(`security-gate-id: ${bcUuid}`), true);
  });

  it("parses #255-style backticks and middle-dot inline model", () => {
    const body =
      "- `security-gate-id:` bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d · `model: claude-sonnet-5-thinking-high` · verdict PASS";
    assert.equal(extractSecurityGateIdValue(body), "bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d");
    assert.equal(hasValidSecurityGateId(body), true);
  });

  it("rejects NOT RUN", () => {
    assert.equal(hasValidSecurityGateId("security-gate-id: NOT RUN"), false);
    assert.equal(hasValidSecurityGateId("security-gate-id:  not  run"), false);
  });

  it("rejects empty value", () => {
    assert.equal(hasValidSecurityGateId("security-gate-id:"), false);
    assert.equal(hasValidSecurityGateId("security-gate-id:   "), false);
  });

  it("rejects deadbeef and bc-deadbeef", () => {
    assert.equal(hasValidSecurityGateId("security-gate-id: deadbeef"), false);
    assert.equal(hasValidSecurityGateId("security-gate-id: bc-deadbeef"), false);
  });
});

describe("hasAllowedGateModel", () => {
  it("accepts Sonnet 5 thinking-high slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-sonnet-5-thinking-high"), true);
  });

  it("rejects retired Sonnet 4.6 medium-thinking slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-4.6-sonnet-medium-thinking"), false);
  });

  it("rejects retired Sonnet 4.6 high-thinking slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-4.6-sonnet-high-thinking"), false);
  });

  it("rejects non-allowlist slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-fable-5-thinking-high"), false);
  });

  it("rejects Composer / Grok substitutes", () => {
    assert.equal(hasAllowedGateModel("model: composer-2.5-fast"), false);
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.5-high-fast"), false);
  });
});

describe("packageJsonHighRisk", () => {
  const base = {
    scripts: { build: "tsc" },
    dependencies: { firebase: "^12.0.0" },
    devDependencies: {},
  };

  it("returns true when scripts differ", () => {
    const head = { ...base, scripts: { build: "vite build" } };
    assert.equal(packageJsonHighRisk(base, head), true);
  });

  it("returns true on firebase major bump", () => {
    const head = { ...base, dependencies: { firebase: "^13.0.0" } };
    assert.equal(packageJsonHighRisk(base, head), true);
  });

  it("returns false on firebase minor bump", () => {
    const head = { ...base, dependencies: { firebase: "^12.1.0" } };
    assert.equal(packageJsonHighRisk(base, head), false);
  });

  it("returns false on unrelated dep change", () => {
    const head = { ...base, dependencies: { firebase: "^12.0.0", react: "^19.0.0" } };
    assert.equal(packageJsonHighRisk(base, head), false);
  });

  it("returns false when base is missing", () => {
    assert.equal(packageJsonHighRisk(null, base), false);
  });
});

describe("checkEvidence", () => {
  const gateId = "security-gate-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const bcGateId = "security-gate-id: bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d";

  const validBodySonnet5 = [gateId, REQUIRED_MODEL_LINE, "actual model invocation evidence: yes"].join(
    "\n",
  );

  it("passes when no high-risk changes", () => {
    const result = checkEvidence("", false);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("fails when security-gate-id missing", () => {
    const body = REQUIRED_MODEL_LINE;
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("security-gate-id")));
  });

  it("passes when model line missing but valid uuid id present", () => {
    const body = gateId;
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
    assert.ok(result.warnings.some((w) => w.includes("model:")));
  });

  it("passes bc- uuid without model", () => {
    const result = checkEvidence(bcGateId, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes bc- uuid with allowlisted model on next line", () => {
    const body = [bcGateId, REQUIRED_MODEL_LINE].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes #255-style backticks and middle-dot inline model", () => {
    const body =
      "- `security-gate-id:` bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d · `model: claude-sonnet-5-thinking-high` · verdict PASS";
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("rejects security-gate-id NOT RUN", () => {
    const result = checkEvidence("security-gate-id: NOT RUN", true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.includes(MISSING_SECURITY_GATE_ID_HINT));
  });

  it("rejects empty security-gate-id value", () => {
    const result = checkEvidence("security-gate-id:", true);
    assert.equal(result.pass, false);
  });

  it("rejects deadbeef id", () => {
    const result = checkEvidence("security-gate-id: deadbeef", true);
    assert.equal(result.pass, false);
  });

  it("rejects bc-deadbeef id", () => {
    const result = checkEvidence("security-gate-id: bc-deadbeef", true);
    assert.equal(result.pass, false);
  });

  it("rejects uppercase bc- uuid", () => {
    const result = checkEvidence(
      "security-gate-id: bc-A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
      true,
    );
    assert.equal(result.pass, false);
  });

  it("fails #254-style body with no security-gate-id line", () => {
    const body254 = [
      "## Summary",
      "functions-change evidence",
      "verdict: PASS",
    ].join("\n");
    const result = checkEvidence(body254, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("security-gate-id")));
  });

  it("passes when Sonnet 5 model line present", () => {
    const result = checkEvidence(validBodySonnet5, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes when allowlist[0] model line present", () => {
    const body = [
      gateId,
      `model: ${ALLOWED_GATE_MODELS[0]}`,
      "actual model invocation evidence: yes",
    ].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes when non-allowlist model line present (id valid; model not enforced by CI)", () => {
    const body = [gateId, "model: claude-fable-5-thinking-high"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes when retired Sonnet 4.6 model line present (id valid)", () => {
    const body = [gateId, "model: claude-4.6-sonnet-medium-thinking"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });
});

describe("resolveEvidence", () => {
  const readFile = () => "file-body";
  const gitLog = () => "commit-body";

  it("env body wins over everything", () => {
    const out = resolveEvidence({
      envBody: "env-body",
      prBodyFile: "pr.md",
      evidenceFromCommits: true,
      readFile,
      gitLog,
    });
    assert.equal(out, "env-body");
  });

  it("empty-string env body still wins (set beats unset)", () => {
    const out = resolveEvidence({
      envBody: "",
      prBodyFile: "pr.md",
      evidenceFromCommits: true,
      readFile,
      gitLog,
    });
    assert.equal(out, "");
  });

  it("pr body file next when env unset", () => {
    const out = resolveEvidence({
      envBody: null,
      prBodyFile: "pr.md",
      evidenceFromCommits: true,
      readFile,
      gitLog,
    });
    assert.equal(out, "file-body");
  });

  it("commit messages next when env and file unset", () => {
    const out = resolveEvidence({
      envBody: null,
      prBodyFile: null,
      evidenceFromCommits: true,
      readFile,
      gitLog,
    });
    assert.equal(out, "commit-body");
  });

  it("defaults to empty string", () => {
    const out = resolveEvidence({
      envBody: null,
      prBodyFile: null,
      evidenceFromCommits: false,
      readFile,
      gitLog,
    });
    assert.equal(out, "");
  });
});
