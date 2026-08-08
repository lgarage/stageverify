#!/usr/bin/env node
/**
 * Unit tests for PROJECT_STATUS/ui-model-routing.json (D-63 SSOT)
 * Run: npm run gate:check:test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routingPath = join(__dirname, "..", "PROJECT_STATUS", "ui-model-routing.json");
const routing = JSON.parse(readFileSync(routingPath, "utf8"));

describe("ui-model-routing.json (D-63)", () => {
  it("records canonical Sol Medium slug gpt-5.6-sol-medium", () => {
    assert.equal(routing.canonicalMediumSlug, "gpt-5.6-sol-medium");
    assert.equal(routing.preferredPrimary, "gpt-5.6-sol-medium");
    assert.equal(routing.primary, "gpt-5.6-sol-medium");
  });

  it("locks verifier to cursor-grok-4.5-high-fast", () => {
    assert.equal(routing.verifier, "cursor-grok-4.5-high-fast");
  });

  it("records Task allowlist rejection of Medium and Task escalate primary High", () => {
    assert.equal(routing.taskSubagentAllowlistAcceptsMedium, false);
    assert.equal(routing.automatedTaskPrimary, "gpt-5.6-sol-high");
    assert.equal(routing.taskSubagentProbe?.slug, "gpt-5.6-sol-medium");
  });

  it("has Sol-only fallbacks starting with High (Task escalate ladder)", () => {
    assert.ok(Array.isArray(routing.fallbacks));
    assert.ok(routing.fallbacks.length > 0);
    assert.equal(routing.fallbacks[0], "gpt-5.6-sol-high");
    for (const slug of routing.fallbacks) {
      assert.notEqual(slug, "composer-2.5-fast");
      assert.notEqual(slug, "composer");
      assert.match(slug, /^gpt-5\.6-sol-/);
    }
  });

  it("includes ui-component and css-restyle in uiArchetypes", () => {
    assert.ok(routing.uiArchetypes.includes("ui-component"));
    assert.ok(routing.uiArchetypes.includes("css-restyle"));
  });

  it("keeps Sonnet gates listed as unchanged", () => {
    assert.ok(routing.sonnetGatesUnchanged.includes("D-38"));
    assert.ok(routing.sonnetGatesUnchanged.includes("D-60"));
  });
});
