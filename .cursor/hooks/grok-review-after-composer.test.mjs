import assert from "node:assert/strict";
import test from "node:test";
import { apply, decide, emptyState, isGrokHighFastOff, isResearchPrompt, MAX_ROUNDS } from "./grok-review-after-composer.mjs";

const composer = { model: "composer-2.5" };
const grok = { subagent_model: "grok-4.7-high" };

test("research about updating the program is in scope, and the hook's own follow-up is not", () => {
  assert.equal(isResearchPrompt("how the program can be updated"), true);
  assert.equal(isResearchPrompt("research a safer pickup flow"), true);
  assert.equal(isResearchPrompt("what time is it"), false);
  assert.equal(isResearchPrompt("GROK_REVIEW_LOOP\nRevise the research answer"), false);
});

test("grok-4.7-high counts and the fast slug does not", () => {
  assert.equal(isGrokHighFastOff(grok), true);
  assert.equal(isGrokHighFastOff({ subagent_model: "grok-4.7-high-fast" }), false);
});

test("research FAIL comes back, the revision is reviewed, and PASS stops", () => {
  let state = emptyState();
  state = apply(state, decide({ hook_event_name: "beforeSubmitPrompt", prompt: "how the program can be updated", ...composer }, state));
  let step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.kind, "review");
  assert.match(step.followup_message, /research answer/);
  state = apply(state, step);

  state = apply(state, decide({ ...grok, hook_event_name: "subagentStop", summary: "VERDICT: FAIL\nName the file the change would touch." }, state));
  step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.kind, "fix");
  assert.match(step.followup_message, /Revise the research/);
  state = apply(state, step);

  state = apply(state, decide({ ...composer, hook_event_name: "afterAgentResponse", text: "Revised research." }, state));
  step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.kind, "review");
  state = apply(state, step);

  state = apply(state, decide({ ...grok, hook_event_name: "subagentStop", summary: "VERDICT: PASS" }, state));
  assert.equal(decide({ ...composer, hook_event_name: "stop", status: "completed" }, state).action, "noop");
});

test("a code FAIL still comes back as a code fix", () => {
  let state = apply(emptyState(), decide({ ...composer, hook_event_name: "afterFileEdit" }, emptyState()));
  state = apply(state, decide({ ...composer, hook_event_name: "stop", status: "completed" }, state));
  state = apply(state, decide({ ...grok, hook_event_name: "subagentStop", summary: "VERDICT: FAIL\nFix src/App.tsx label." }, state));
  const step = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(step.kind, "fix");
  assert.match(step.followup_message, /Update the code/);
  assert.match(step.followup_message, /src\/App\.tsx/);
});

test("a missing verdict is treated as not satisfied", () => {
  const decision = decide({ ...grok, hook_event_name: "subagentStop", summary: "looks fine" }, emptyState());
  assert.equal(decision.verdict, "FAIL");
});

test("the loop stops after the round cap", () => {
  const state = { ...emptyState(), needsReview: true, subject: "research", rounds: MAX_ROUNDS, verdict: "FAIL" };
  const decision = decide({ ...composer, hook_event_name: "stop", status: "completed" }, state);
  assert.equal(decision.action, "cap");
  const capped = apply(state, decision);
  assert.equal(decide({ ...composer, hook_event_name: "stop", status: "completed" }, capped).action, "noop");
});

test("a question with no edits and no research does not start a review", () => {
  assert.equal(decide({ ...composer, hook_event_name: "stop", status: "completed" }, emptyState()).action, "noop");
});
