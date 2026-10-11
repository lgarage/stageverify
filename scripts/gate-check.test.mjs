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
  MISSING_SONNET_BACKUP_HINT,
  AUTHOR_GATE_ID_HINT,
  hasAllowedGateModel,
  extractGateModelSlugs,
  extractReviewEvidenceText,
  extractSecurityGateIdValue,
  hasValidSecurityGateId,
  classifyPath,
  requiresSonnetBackup,
  packageJsonHighRisk,
  checkEvidence,
  resolveEvidence,
  shouldHonorGateSkip,
  honorsGateSkip,
  extractAuthorAgentIds,
} from "./gate-check.mjs";

describe("classifyPath", () => {
  it("flags firestore.rules as high-risk", () => {
    assert.deepEqual(classifyPath("firestore.rules"), ["high-risk"]);
  });

  it("flags all functions/src as high-risk (D-28 restore)", () => {
    const tags = classifyPath("functions/src/index.ts");
    assert.ok(tags.includes("high-risk"));
    assert.ok(tags.includes("substantive-ship"));
  });

  it("flags applyVendorReplyClearBackorder CF as high-risk", () => {
    assert.ok(
      classifyPath("functions/src/applyVendorReplyClearBackorder.ts").includes("high-risk"),
    );
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

  it("flags generic CF paths as high-risk (D-28)", () => {
    assert.ok(classifyPath("functions/src/getVendorRunDeliveries.ts").includes("high-risk"));
    assert.ok(
      classifyPath("functions/src/inboundEmail/sanitizeParsedLines.ts").includes("high-risk"),
    );
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

  it("does not parse security-gate-id inside inline code spans only", () => {
    const body =
      "- `security-gate-id:` bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d · `model: claude-sonnet-5-thinking-high` · verdict PASS";
    const evidence = extractReviewEvidenceText(body);
    assert.equal(extractSecurityGateIdValue(evidence), null);
    assert.equal(hasValidSecurityGateId(evidence), false);
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
  it("accepts Grok 4.6 high (primary HIGH reviewer)", () => {
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.6-high"), true);
  });

  it("accepts Grok 4.6 xhigh", () => {
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.6-xhigh"), true);
  });

  it("accepts Sonnet 5 thinking-high (escalation)", () => {
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

  it("rejects Composer / cheaper Grok substitutes", () => {
    assert.equal(hasAllowedGateModel("model: composer-2.5-fast"), false);
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.5-high-fast"), false);
  });

  it("rejects -fast suffix on cursor-grok-4.6-high (finding 1)", () => {
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.6-high-fast"), false);
    assert.deepEqual(extractGateModelSlugs("model: cursor-grok-4.6-high-fast"), []);
  });

  it("rejects -fast suffix on cursor-grok-4.6-xhigh (finding 1)", () => {
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.6-xhigh-fast"), false);
    assert.deepEqual(extractGateModelSlugs("model: cursor-grok-4.6-xhigh-fast"), []);
  });

  it("accepts exact cursor-grok-4.6-high and xhigh slugs", () => {
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.6-high"), true);
    assert.equal(hasAllowedGateModel("model: cursor-grok-4.6-xhigh"), true);
  });

  it("rejects model line only inside inline code spans", () => {
    assert.equal(hasAllowedGateModel("`model: cursor-grok-4.6-high`"), false);
  });
});

describe("requiresSonnetBackup", () => {
  it("true for firestore.rules and auth paths", () => {
    assert.equal(requiresSonnetBackup("firestore.rules"), true);
    assert.equal(requiresSonnetBackup("src/vendor/VendorPinGate.tsx"), true);
    assert.equal(requiresSonnetBackup("functions/src/setAccessPin.ts"), true);
  });

  it("false for gate-config-only HIGH", () => {
    assert.equal(requiresSonnetBackup("scripts/gate-check.mjs"), false);
    assert.equal(requiresSonnetBackup(".github/workflows/pr-ci.yml"), false);
  });
});

describe("GATE_SKIP / honorsGateSkip", () => {
  it("never honors GATE_SKIP", () => {
    assert.equal(honorsGateSkip(), false);
    assert.equal(shouldHonorGateSkip({ GATE_SKIP: "1", CI: "true" }), false);
  });

  it("GATE_SKIP=1 does not pass HIGH missing-evidence checkEvidence", () => {
    const prevSkip = process.env.GATE_SKIP;
    const prevCi = process.env.CI;
    process.env.GATE_SKIP = "1";
    process.env.CI = "true";
    try {
      assert.equal(honorsGateSkip(), false);
      assert.equal(shouldHonorGateSkip(process.env), false);
      const result = checkEvidence("", true);
      assert.equal(result.pass, false);
    } finally {
      if (prevSkip === undefined) delete process.env.GATE_SKIP;
      else process.env.GATE_SKIP = prevSkip;
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
    }
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

  it("fails when model line missing but valid uuid id present", () => {
    const body = gateId;
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("fails bc- uuid without model", () => {
    const result = checkEvidence(bcGateId, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("passes bc- uuid with allowlisted Grok model on next line", () => {
    const body = [bcGateId, REQUIRED_MODEL_LINE].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("fails #255-style backticks-only labels (code-span bypass)", () => {
    const body =
      "- `security-gate-id:` bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d · `model: cursor-grok-4.6-high` · verdict PASS";
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("security-gate-id")));
  });

  it("passes ## Review evidence section at end of body", () => {
    const body = [
      "Docs example only: `model: cursor-grok-4.6-high`",
      "## Review evidence",
      gateId,
      REQUIRED_MODEL_LINE,
    ].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes dedicated review-evidence HTML block with Grok model", () => {
    const body = [
      "## Summary",
      "Example in docs: `model: cursor-grok-4.6-high`",
      "<!-- review-evidence -->",
      gateId,
      REQUIRED_MODEL_LINE,
      "<!-- /review-evidence -->",
    ].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("fails live-PR-style backtick model example plus bare uuid outside block", () => {
    const body = [
      "Copy this into PR: `model: cursor-grok-4.6-high`",
      "security-gate-id: bc-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("fails fenced code-block model plus valid uuid", () => {
    const body = [
      gateId,
      "```",
      "model: cursor-grok-4.6-high",
      "```",
    ].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("fails valid uuid with high-fast model suffix", () => {
    const body = [gateId, "model: cursor-grok-4.6-high-fast"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("fails gate id equal to PR author agent footer link", () => {
    const authorUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const body = [
      `Made with [Cursor](https://cursor.com/agents/${authorUuid})`,
      "<!-- review-evidence -->",
      `security-gate-id: bc-${authorUuid}`,
      REQUIRED_MODEL_LINE,
      "<!-- /review-evidence -->",
    ].join("\n");
    const authorIds = extractAuthorAgentIds(body, null);
    const result = checkEvidence(body, true, { authorAgentIds: authorIds });
    assert.equal(result.pass, false);
    assert.ok(result.missing.includes(AUTHOR_GATE_ID_HINT));
  });

  it("fails firestore.rules path with Grok-only when Sonnet backup required", () => {
    const body = [gateId, REQUIRED_MODEL_LINE].join("\n");
    const result = checkEvidence(body, true, { requiresSonnetBackup: true });
    assert.equal(result.pass, false);
    assert.ok(result.missing.includes(MISSING_SONNET_BACKUP_HINT));
  });

  it("passes Grok plus Sonnet when Sonnet backup required", () => {
    const body = [
      gateId,
      "model: cursor-grok-4.6-high",
      "model: claude-sonnet-5-thinking-high",
    ].join("\n");
    const result = checkEvidence(body, true, { requiresSonnetBackup: true });
    assert.equal(result.pass, true);
  });

  it("fails VendorPinGate Grok-only when Sonnet backup required", () => {
    assert.equal(requiresSonnetBackup("src/vendor/VendorPinGate.tsx"), true);
    const body = [gateId, REQUIRED_MODEL_LINE].join("\n");
    const result = checkEvidence(body, true, { requiresSonnetBackup: true });
    assert.equal(result.pass, false);
    assert.ok(result.missing.includes(MISSING_SONNET_BACKUP_HINT));
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

  it("passes when primary Grok model line present", () => {
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

  it("fails when non-allowlist model line present even if id valid", () => {
    const body = [gateId, "model: claude-fable-5-thinking-high"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("fails when retired Sonnet 4.6 model line present even if id valid", () => {
    const body = [gateId, "model: claude-4.6-sonnet-medium-thinking"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
  });

  it("fails when Composer model line present even if id valid", () => {
    const body = [gateId, "model: composer-2.5-fast"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.some((m) => m.includes("model:")));
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
