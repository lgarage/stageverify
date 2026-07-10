#!/usr/bin/env node
/**
 * Offline tests for command interface intent routing + harness bridge (no Slack).
 */
import { routeIntent } from "./command-interface/intentRouter.mjs";
import { executeIntent } from "./command-interface/harnessBridge.mjs";
import { readControl, writeControl } from "./command-interface/harnessBridge.mjs";

const cases = [
  { input: "What are you working on?", expect: "status" },
  { input: "What's blocking us?", expect: "blockers" },
  { input: "Summarize the current phase.", expect: "phase_summary" },
  { input: "What review failed?", expect: "review_failed" },
  { input: "Pause after this task.", expect: "pause" },
  { input: "Continue.", expect: "resume" },
  { input: "What changed?", expect: "what_changed" },
  { input: "Deploy now", expect: "unsupported" },
  { input: "asdf qwerty zxcv", expect: "clarify" },
];

let failed = 0;

console.log("=== intent router ===");
for (const c of cases) {
  const routed = routeIntent(c.input);
  const pass = routed.type === c.expect;
  console.log(`${pass ? "PASS" : "FAIL"}: "${c.input}" → ${routed.type} (want ${c.expect})`);
  if (!pass) failed++;
}

console.log("\n=== harness bridge (sample) ===");
const status = await executeIntent({ type: "status", confidence: 0.9 });
const hasDigest = status.text.includes("DONE:") && status.text.includes("NOW:");
console.log(`${hasDigest ? "PASS" : "FAIL"}: status response has DONE/NOW`);
if (!hasDigest) failed++;

const before = readControl();
writeControl({ paused: true });
const paused = readControl();
writeControl({ paused: before.paused, pauseAfterCurrentTask: before.pauseAfterCurrentTask });
console.log(`${paused.paused ? "PASS" : "FAIL"}: pause control writes away-list`);
if (!paused.paused) failed++;

const resume = await executeIntent({ type: "resume", confidence: 0.9 });
console.log(`${resume.text.includes("Pause flags cleared") ? "PASS" : "FAIL"}: resume clears pause`);
if (!resume.text.includes("Pause flags cleared")) failed++;

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
