#!/usr/bin/env node
/**
 * Unit tests for scripts/verifier-log.mjs pure functions.
 * Run: npm run gate:check:test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseKvArgs, dedupeRows, computeStats } from "./verifier-log.mjs";

describe("parseKvArgs", () => {
  it("maps kebab-case keys to camelCase", () => {
    const opts = parseKvArgs(["--task-id", "abc-123", "--role", "qa"]);
    assert.equal(opts.taskId, "abc-123");
    assert.equal(opts.role, "qa");
    assert.ok(!("task-id" in opts));
  });

  it("maps kebab-case keys in --key=value form", () => {
    const opts = parseKvArgs(["--task-id=xyz-9"]);
    assert.equal(opts.taskId, "xyz-9");
  });

  it("handles --stats flag", () => {
    assert.equal(parseKvArgs(["--stats"]).stats, "true");
  });
});

describe("dedupeRows", () => {
  it("keeps last write for same (taskId, role)", () => {
    const rows = [
      { taskId: "t1", role: "qa", verdict: "FAIL", real: "na" },
      { taskId: "t1", role: "qa", verdict: "PASS", real: "na" },
      { taskId: "t1", role: "ship", verdict: "FAIL", real: "yes" },
    ];
    const deduped = dedupeRows(rows);
    assert.equal(deduped.length, 2);
    const qaRow = deduped.find((r) => r.role === "qa");
    assert.equal(qaRow.verdict, "PASS");
  });
});

describe("computeStats", () => {
  it("computes finding precision over labeled non-PASS rows only", () => {
    const rows = [
      { taskId: "t1", role: "qa", verdict: "PARTIAL", real: "yes" },
      { taskId: "t2", role: "ship", verdict: "FAIL", real: "yes" },
      { taskId: "t3", role: "qa", verdict: "PARTIAL", real: "no" },
      { taskId: "t4", role: "qa", verdict: "PASS", real: "na" },
    ];
    const stats = computeStats(rows);
    assert.equal(stats.labeledReal, 2);
    assert.equal(stats.labeledNoise, 1);
    assert.equal(stats.findingPrecision, 2 / 3);
    assert.equal(stats.mislabeledPassRows, 0);
  });

  it("counts unlabeled findings and NOT_RUN", () => {
    const rows = [
      { taskId: "t1", role: "qa", verdict: "FAIL", real: "na" },
      { taskId: "t2", role: "ship", verdict: "NOT_RUN", real: "na" },
    ];
    const stats = computeStats(rows);
    assert.equal(stats.unlabeledFindings, 1);
    assert.equal(stats.notRunCount, 1);
    assert.equal(stats.findingPrecision, null);
  });

  it("flags PASS rows labeled yes|no as mislabeled, excluded from precision", () => {
    const rows = [
      { taskId: "t1", role: "qa", verdict: "PASS", real: "yes" },
      { taskId: "t2", role: "qa", verdict: "PASS", real: "no" },
      { taskId: "t3", role: "qa", verdict: "PARTIAL", real: "yes" },
    ];
    const stats = computeStats(rows);
    assert.equal(stats.mislabeledPassRows, 2);
    assert.equal(stats.labeledReal, 1);
    assert.equal(stats.labeledNoise, 0);
    assert.equal(stats.findingPrecision, 1);
  });

  it("tallies per-role and per-verdict counts", () => {
    const rows = [
      { taskId: "t1", role: "qa", verdict: "PASS", real: "na" },
      { taskId: "t2", role: "qa", verdict: "FAIL", real: "yes" },
      { taskId: "t3", role: "security", verdict: "HIGH", real: "yes" },
    ];
    const stats = computeStats(rows);
    assert.deepEqual(stats.perRole, { qa: 2, security: 1 });
    assert.deepEqual(stats.perVerdict, { PASS: 1, FAIL: 1, HIGH: 1 });
  });
});
