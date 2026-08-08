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
  it("locks primary to gpt-5.6-sol-high", () => {
    assert.equal(routing.primary, "gpt-5.6-sol-high");
  });

  it("locks verifier to cursor-grok-4.5-high-fast", () => {
    assert.equal(routing.verifier, "cursor-grok-4.5-high-fast");
  });

  it("records requested Sol Medium as unavailable", () => {
    assert.equal(routing.requestedPrimary, "gpt-5.6-sol-medium");
    assert.equal(routing.requestedPrimaryStatus, "unavailable");
  });

  it("has non-empty fallbacks that exclude composer", () => {
    assert.ok(Array.isArray(routing.fallbacks));
    assert.ok(routing.fallbacks.length > 0);
    for (const slug of routing.fallbacks) {
      assert.notEqual(slug, "composer-2.5-fast");
      assert.notEqual(slug, "composer");
    }
  });

  it("includes ui-component and css-restyle in uiArchetypes", () => {
    assert.ok(routing.uiArchetypes.includes("ui-component"));
    assert.ok(routing.uiArchetypes.includes("css-restyle"));
  });
});
