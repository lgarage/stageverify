import assert from "node:assert/strict";
import test from "node:test";
import { apply, decide, emptyState, extractVerdict, isGrokHighFastOff, MAX_ROUNDS } from "./grok-review-after-composer.mjs";

const composer = { model: "composer-2.5" };
const grok = { subagent_model: "grok-4.7-high" };

test("the last VERDICT line wins", () => {
  assert.equal(extractVerdict("VERDICT: FAIL\nlater VERDICT: PASS"), "PASS");
  assert.equal(extractVerdict("no marker"), "");
});

test("grok-4.7-high counts and the fast slug does not", () => {
  assert.equal(isGrokHighFastOff(grok), true);
  assert.equal(isGrokHighFastOff({ subagent_model: "grok-4.7-high-fast" }), false);
});

test("FAIL comes back to Composer, then a new edit is reviewed again, until PASS", () => {
  let state = emptyState();
  state = apply(state, decide({ ...composer, hook_event_name: "afterFileEdit" }, state));
  let step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.action, "followup");
  assert.match(step.followup_message, /composer-diff-review/);

  state = apply(
    state,
    decide(
      {
        ...grok,
        hook_event_name: "subagentStop",
        summary: "VERDICT: FAIL\nFix src/App.tsx label.",
      },
      state,
    ),
  );
  assert.equal(state.verdict, "FAIL");
  assert.equal(state.dirty, false);
  step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.action, "followup");
  assert.match(step.followup_message, /not satisfied/);
  assert.match(step.followup_message, /src\/App\.tsx/);

  state = apply(state, decide({ ...composer, hook_event_name: "afterFileEdit" }, state));
  step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.match(step.followup_message, /latest Composer edits/);

  state = apply(
    state,
    decide({ ...grok, hook_event_name: "subagentStop", summary: "VERDICT: PASS" }, state),
  );
  assert.equal(state.verdict, "PASS");
  step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.action, "noop");
});

test("a missing verdict is treated as not satisfied", () => {
  const decision = decide({ ...grok, hook_event_name: "subagentStop", summary: "looks fine" }, emptyState());
  assert.equal(decision.verdict, "FAIL");
});

test("the loop stops after the round cap", () => {
  const state = { ...emptyState(), dirty: true, rounds: MAX_ROUNDS, verdict: "FAIL" };
  const decision = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(decision.action, "cap");
  const capped = apply(state, decision);
  assert.equal(decide({ ...composer, hook_event_name: "stop", status: "completed" }, capped).action, "noop");
});

test("a question with no edits does not start a review", () => {
  assert.equal(decide({ ...composer, hook_event_name: "stop", status: "completed" }, emptyState()).action, "noop");
});
