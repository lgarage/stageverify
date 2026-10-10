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
  const tmp = join(__dirname, `_tmp-preflight-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
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

describe("ship-evidence-preflight (D-94)", () => {
  it("FAIL high-risk with only a valid security-gate-id (model required)", () => {
    const body = `security-gate-id: 12345678-1234-1234-1234-123456789abc\n`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /model:/);
  });

  it("PASS high-risk with bc- uuid and Grok model", () => {
    const body = `security-gate-id: bc-3594ac4e-aad0-57f6-be0a-5cb813a3f25d\nmodel: cursor-grok-4.6-high\n`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 0, r.stderr);
  });

  it("PASS high-risk with Sonnet escalation model", () => {
    const body = `security-gate-id: 12345678-1234-1234-1234-123456789abc\nmodel: claude-sonnet-5-thinking-high\n`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 0, r.stderr);
  });

  it("FAIL high-risk when security-gate-id missing", () => {
    const body = `model: claude-sonnet-5-thinking-high\nsonnet-instruct: abc\n`;
    const r = run(body, "high-risk");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /security-gate-id/);
  });

  it("FAIL high-risk when security-gate-id is NOT RUN", () => {
    const r = run("security-gate-id: NOT RUN\n", "high-risk");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /NOT RUN|security-gate-id/);
  });

  it("FAIL high-risk on junk id", () => {
    const r = run("security-gate-id: deadbeef\n", "high-risk");
    assert.equal(r.status, 1);
  });

  it("PASS default / medium / low without ship-verifier or build-checker", () => {
    for (const cls of ["default", "medium", "low", "tiny-fast-safe", "t2-prod-sensitive"]) {
      const r = run("just a report\n", cls);
      assert.equal(r.status, 0, `${cls}: ${r.stderr}`);
    }
  });
});
