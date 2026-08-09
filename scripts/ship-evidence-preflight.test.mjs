#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, "ship-evidence-preflight.mjs");

function run(body, cls) {
  const tmp = join(__dirname, `_tmp-preflight-${Date.now()}.txt`);
  writeFileSync(tmp, body, "utf8");
  try {
    return spawnSync(process.execPath, [script, "--file", tmp, "--class", cls], {
      encoding: "utf8",
    });
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

describe("ship-evidence-preflight (D-65)", () => {
  it("PASS high-risk when all tokens present", () => {
    const body = `
sonnet-instruct: abc-123 Agree
high-risk-adversarial: adv-111 PASS
sonnet-verify: def-456 PASS
security-gate-id: 12345678-1234-1234-1234-123456789abc
model: claude-sonnet-5-thinking-high
ship-verifier: ghi-789 PASS
`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /PASS/);
  });

  it("FAIL high-risk when high-risk-adversarial missing", () => {
    const body = `
sonnet-instruct: abc Agree
sonnet-verify: def PASS
security-gate-id: 12345678-1234-1234-1234-123456789abc
model: claude-sonnet-5-thinking-high
ship-verifier: ghi
`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /high-risk-adversarial/);
  });

  it("FAIL high-risk when security-gate-id missing", () => {
    const body = `
sonnet-instruct: abc
high-risk-adversarial: adv PASS
sonnet-verify: def PASS
ship-verifier: ghi
model: claude-sonnet-5-thinking-high
`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /security-gate-id/);
  });

  it("PASS tiny-fast-safe with ui-before-after N/A", () => {
    const body = `ui-before-after: N/A (no visible UI)\n`;
    const r = run(body, "tiny-fast-safe");
    assert.equal(r.status, 0, r.stderr);
  });
});
