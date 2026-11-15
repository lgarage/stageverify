import assert from "node:assert/strict";
import test from "node:test";
import { decide, isComposer, isGrokHighFastOff } from "./grok-review-after-composer.mjs";

const composer = { model: "composer-2.5", model_id: "composer-2.5" };
const grok = { subagent_model: "grok-4.7-high" };
const fresh = { edited: false, reviewed: false };

test("Composer file edit is remembered", () => {
  assert.equal(isComposer(composer), true);
  assert.deepEqual(decide({ ...composer, hook_event_name: "afterFileEdit" }, fresh), { action: "mark-edited" });
});

test("Grok edits do not ask for another review", () => {
  assert.deepEqual(
    decide({ model: "grok-4.7-high", hook_event_name: "afterFileEdit" }, fresh),
    { action: "noop" },
  );
});

test("grok-4.7-high counts and the fast slug does not", () => {
  assert.equal(isGrokHighFastOff(grok), true);
  assert.equal(isGrokHighFastOff({ subagent_model: "grok-4.7-high-fast" }), false);
  assert.equal(
    isGrokHighFastOff({
      model: "grok-4.7",
      model_params: [
        { id: "effort", value: "high" },
        { id: "fast", value: "false" },
      ],
    }),
    true,
  );
  assert.equal(
    isGrokHighFastOff({
      model: "grok-4.7",
      model_params: [
        { id: "effort", value: "high" },
        { id: "fast", value: "true" },
      ],
    }),
    false,
  );
});

test("Composer stop after an edit asks for one grok-4.7-high review", () => {
  const decision = decide(
    { ...composer, hook_event_name: "stop", status: "completed", loop_count: 0 },
    { edited: true, reviewed: false },
  );
  assert.equal(decision.action, "followup");
  assert.match(decision.followup_message, /grok-4\.7-high/);
  assert.match(decision.followup_message, /Fast off/);
});

test("a finished review or a question with no edits does not follow up", () => {
  assert.equal(
    decide(
      { ...composer, hook_event_name: "stop", status: "completed", loop_count: 0 },
      { edited: true, reviewed: true },
    ).action,
    "noop",
  );
  assert.equal(
    decide(
      { ...composer, hook_event_name: "stop", status: "completed", loop_count: 0 },
      fresh,
    ).action,
    "noop",
  );
  assert.equal(
    decide(
      { ...composer, hook_event_name: "stop", status: "completed", loop_count: 1 },
      { edited: true, reviewed: false },
    ).action,
    "noop",
  );
});

test("a completed grok-4.7-high subagent marks the review done", () => {
  assert.deepEqual(
    decide({ ...grok, hook_event_name: "subagentStop", status: "completed" }, { edited: true, reviewed: false }),
    { action: "mark-reviewed" },
  );
});
