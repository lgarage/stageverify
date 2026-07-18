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
  hasAllowedGateModel,
  classifyPath,
  packageJsonHighRisk,
  checkEvidence,
  resolveEvidence,
} from "./gate-check.mjs";

describe("classifyPath", () => {
  it("flags firestore.rules as high-risk", () => {
    assert.deepEqual(classifyPath("firestore.rules"), ["high-risk"]);
  });

  it("flags functions/src as dual high-risk and substantive-ship", () => {
    const tags = classifyPath("functions/src/index.ts");
    assert.ok(tags.includes("high-risk"));
    assert.ok(tags.includes("substantive-ship"));
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

  it("hits src auth heuristic", () => {
    assert.ok(classifyPath("src/auth/login.tsx").includes("high-risk"));
    assert.ok(classifyPath("src/dispatcher/sessionStore.ts").includes("high-risk"));
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

  it("rejects uppercase uuid", () => {
    const body = "security-gate-id: A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    assert.ok(!SECURITY_GATE_ID_RE.test(body));
  });

  it("rejects short invalid id", () => {
    const body = "security-gate-id: deadbeef";
    assert.ok(!SECURITY_GATE_ID_RE.test(body));
  });
});

describe("hasAllowedGateModel", () => {
  it("accepts high-thinking slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-4.6-sonnet-high-thinking"), true);
  });

  it("accepts medium-thinking slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-4.6-sonnet-medium-thinking"), true);
  });

  it("rejects non-allowlist slug", () => {
    assert.equal(hasAllowedGateModel("model: claude-fable-5-thinking-high"), false);
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

  const validBodyMedium = [gateId, REQUIRED_MODEL_LINE, "actual model invocation evidence: yes"].join(
    "\n",
  );

  const validBodyHigh = [
    gateId,
    `model: ${ALLOWED_GATE_MODELS[0]}`,
    "actual model invocation evidence: yes",
  ].join("\n");

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

  it("fails when model line missing", () => {
    const body = gateId;
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.includes(MISSING_MODEL_LINE_HINT));
  });

  it("passes when medium-thinking model line present", () => {
    const result = checkEvidence(validBodyMedium, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("passes when high-thinking model line present", () => {
    const result = checkEvidence(validBodyHigh, true);
    assert.equal(result.pass, true);
    assert.deepEqual(result.missing, []);
  });

  it("fails when non-allowlist model line present", () => {
    const body = [gateId, "model: claude-fable-5-thinking-high"].join("\n");
    const result = checkEvidence(body, true);
    assert.equal(result.pass, false);
    assert.ok(result.missing.includes(MISSING_MODEL_LINE_HINT));
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
