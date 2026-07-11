#!/usr/bin/env node
/**
 * Atomic away completion: away-list + away-status + CURRENT_STATE + NEXT.md + project_state.md
 * Usage:
 *   node scripts/away-ship.mjs --id away-042 --commit abc1234 --note "..." [--status built|blocked|deferred]
 *
 * Learning capture (automatic — no manual indexer:ingest):
 *   --learned "summary"           explicit SSOT for hard-earned fix
 *   --failure "what happened" --fix "mitigation"
 *   Auto-parse --note for root cause:/fix:/prod verify fail/stale gh-pages patterns
 *
 * --note: short ship summary only (stored verbatim in away-status.json). Do not duplicate
 * Append timing row to PROJECT_STATUS/estimate-log.md separately (single source of truth).
 * Worker posts task-start before implementation and task-finish before completion report;
 * librarian records timestamps — finishedAt = worker task-finish (see estimate-log.md).
 * Optional cross-ref: "timing: estimate-log row N".
 *
 * Example:
 *   --note "gotcha map + context:gotcha CLI; verify PASS; timing: estimate-log row 5"
 *   --note "prod verify failed — stale gh-pages" --learned "Redeploy before :prod verify"
 */
import { execSync } from "node:child_process";
import {
  PATHS,
  firstRunnableItem,
  normalizeExecutionProtocol,
  readJson,
  readText,
  renderNextMd,
  updateImmediateNextInCurrentState,
  updateImmediateNextInProjectState,
  updateLastShippedInCurrentState,
  writeJson,
  writeText,
} from "./lib/away-memory-lib.mjs";
import { captureLearningFromShip } from "./lib/indexer-ingest-lib.mjs";
import { mergePendingVerifyLearnings } from "./lib/verify-learning-hook.mjs";

function usage() {
  console.error(`Usage: node scripts/away-ship.mjs --id away-NNN --commit HASH --note "..."
  [--status built|blocked|deferred] [--dry-run]
  [--learned "summary"] [--failure "what happened"] [--fix "mitigation"]
  [--category lesson|gotcha|…] [--type <type>] [--subtype <subtype>] [--trigger "a,b"]
  [--gate] [--skip-learning]

--note: short ship summary only (no est/actual duplication). Append timing to
PROJECT_STATUS/estimate-log.md separately — worker task-start/finish timestamps
(see AWAY_BUILD_PROTOCOL.md step 7–8 + estimate-log.md).

Learning: --learned is explicit SSOT; --note auto-parses failure/fix signals.
Captured inline to indexer-memory.json — no manual npm run indexer:ingest.`);
  process.exit(1);
}

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      out.dryRun = "true";
      continue;
    }
    if (arg === "--skip-learning") {
      out.skipLearning = "true";
      continue;
    }
    if (arg === "--gate") {
      out.gate = "true";
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = argv[++i];
      if (!val) usage();
      out[key] = val;
    }
  }
  if (!out.id || !out.note) usage();
  if (!out.commit) out.commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  if (!out.status) out.status = "built";
  return out;
}

/** @param {ReturnType<typeof captureLearningFromShip>} learningResult */
function learningMetaFromResult(learningResult) {
  if (!learningResult) return null;
  if (learningResult.action === "indexer-memory" && learningResult.entry?.id) {
    return { id: learningResult.entry.id, action: learningResult.action };
  }
  if (learningResult.action === "lesson" && learningResult.section) {
    return { id: learningResult.section, action: learningResult.action };
  }
  if (learningResult.action === "gotcha-applied" && learningResult.proposal?.id) {
    return { id: learningResult.proposal.id, action: learningResult.action };
  }
  return { action: learningResult.action };
}

function main() {
  const args = parseArgs(process.argv);
  const list = readJson(PATHS.awayList);
  const archive = readJson(PATHS.awayArchive);
  const idx = list.queue.findIndex((q) => q.id === args.id);
  if (idx === -1) {
    console.error(`Item ${args.id} not in active away-list.json`);
    process.exit(1);
  }

  const item = list.queue[idx];

  let learningResult = null;
  let pendingMergeResult = null;
  try {
    learningResult = captureLearningFromShip(args, item, { dryRun: args.dryRun === "true" });
    pendingMergeResult = mergePendingVerifyLearnings({
      sourceTask: args.id,
      dryRun: args.dryRun === "true",
    });
  } catch (err) {
    console.error(`away-ship learning capture failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  list.queue.splice(idx, 1);
  list.executionProtocol.sequence = list.executionProtocol.sequence.filter((id) => id !== args.id);

  const statusDoc = readJson(PATHS.awayStatus);
  statusDoc.lastRun = new Date().toISOString().slice(0, 10);
  statusDoc.results = statusDoc.results.filter((r) => r.id !== args.id);
  /** @type {Record<string, unknown>} */
  const resultRow = {
    id: args.id,
    title: item.title,
    status: args.status,
    commit: args.commit,
    note: args.note,
  };
  const learningMeta = learningMetaFromResult(learningResult);
  if (learningMeta) resultRow.learning = learningMeta;
  statusDoc.results.push(resultRow);

  let currentState = readText(PATHS.currentState);
  currentState = updateLastShippedInCurrentState(currentState, args.id, item.title);
  const nextItem = firstRunnableItem(list.queue, archive, statusDoc.results);
  currentState = updateImmediateNextInCurrentState(currentState, nextItem);
  let projectState = readText(PATHS.projectState);
  projectState = updateImmediateNextInProjectState(projectState, nextItem);
  const nextMd = renderNextMd(nextItem);

  const protocolNorm = normalizeExecutionProtocol(list);
  if (protocolNorm.changed) {
    console.log(`away-ship: normalized executionProtocol — ${protocolNorm.changes.join("; ")}`);
  }

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          list,
          statusDoc,
          learning: learningResult,
          pendingVerifyMerge: pendingMergeResult,
          currentStatePreview: currentState.split("\n").slice(7, 20),
          projectStatePreview: projectState.split("\n").slice(178, 186),
          nextMd,
        },
        null,
        2,
      ),
    );
    return;
  }

  writeJson(PATHS.awayList, list);
  writeJson(PATHS.awayStatus, statusDoc);
  writeText(PATHS.currentState, currentState);
  writeText(PATHS.projectState, projectState);
  writeText(PATHS.nextMd, nextMd);

  console.log(`away-ship: ${args.id} → shipped (${args.status}, ${args.commit})`);
  if (learningMeta) {
    console.log(
      `Learning captured: ${learningMeta.action}${learningMeta.id ? ` → ${learningMeta.id}` : ""}`,
    );
  }
  if (pendingMergeResult?.merged?.length) {
    console.log(
      `Pending verify failures merged: ${pendingMergeResult.merged.length} → indexer-memory`,
    );
  }
  if (nextItem) console.log(`Next queued: ${nextItem.id}`);
  else console.log("No further queued items.");
  console.log("Run: npm run away:validate");
}

main();
