#!/usr/bin/env node
/**
 * Plan-phase brief for away/sleep/overnight — suggests work, does NOT queue.
 * Run: npm run away:plan
 */
import {
  PATHS,
  buildBatchBrief,
  readJson,
} from "./lib/away-memory-lib.mjs";

const list = readJson(PATHS.awayList);
const archive = readJson(PATHS.awayArchive);
const batch = buildBatchBrief(list, archive);

/** @type {{ id: string, title: string, scope: string, tier: string, dependsOn: string, verifyBeforeNext: string[], status: string }[]} */
const suggestedAdditions = [];

const minBatchHint = batch.minBatchHint ?? 3;
const queueStocked = batch.batchSize >= minBatchHint;

if (!queueStocked && batch.batchSize > 0) {
  const lastId = batch.items[batch.items.length - 1]?.id ?? "away-NNN";
  const lastNum = Number.parseInt(lastId.replace(/^away-/, ""), 10);
  const nextId = Number.isFinite(lastNum) ? `away-${String(lastNum + 1).padStart(3, "0")}` : "away-NNN";
  suggestedAdditions.push({
    id: nextId,
    title: "[DRAFT] Short title — scoped offline/T1 work aligned to svscope",
    scope:
      "One paragraph: files touched, blockers that do/do not apply, explicit out-of-scope (no live inbox, no rules changes unless listed).",
    tier: "T1",
    dependsOn: lastId !== "away-NNN" ? lastId : "away-previous",
    verifyBeforeNext: ["npm run build"],
    status: "draft — not queued until Dan approves with 'go build it'",
  });
}

const plan = {
  mode: "plan",
  batchSize: batch.batchSize,
  longBatchExpected: batch.longBatchExpected,
  minBatchHint,
  queuedItems: batch.items,
  suggestedAdditions: queueStocked ? [] : suggestedAdditions,
  ...(queueStocked ? { suggestedAdditionsNote: "queue stocked" } : {}),
  ...(batch.shortBatchWarning ? { shortBatchWarning: batch.shortBatchWarning } : {}),
  workflow: {
    phases: ["Plan", "Approve", "Queue", "Execute"],
    currentPhase: "plan",
    approvePhrases: ["go build it", "queue it", "approved", "yes build that"],
    queueAction: "After approval only — add approved items to PROJECT_STATUS/away-list.json",
    executeAction: "npm run away:batch — verify → away:ship → away:validate per item",
  },
  protocol: batch.protocol,
  firstRunnable: batch.firstRunnable,
  note: "Plan phase only — do not write away-list until Dan approves with 'go build it'",
};

console.log(JSON.stringify(plan, null, 2));
