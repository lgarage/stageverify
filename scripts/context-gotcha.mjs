#!/usr/bin/env node
/**
 * Task-trigger gotcha map — composer-orchestrator steps 6–8 → CLI.
 * Run: npm run context:gotcha -- --task "pickup portal qr bug"
 *      npm run context:gotcha -- --list
 *      npm run context:gotcha -- --task "dispatcher nav" --format markdown
 */
import {
  buildGotchaResult,
  loadGotchaMap,
  matchTriggers,
  renderGotchaMarkdown,
} from "./lib/gotcha-map-lib.mjs";

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage: npm run context:gotcha -- --task "<description>" [--format json|markdown]
       npm run context:gotcha -- --list`);
  process.exit(1);
}

function printList(map) {
  console.log("Gotcha map — task triggers (composer steps 6–8):\n");
  for (const trigger of map.triggers) {
    const steps = (trigger.orchestratorSteps ?? []).length
      ? `steps ${trigger.orchestratorSteps.join(",")}`
      : "hot tier / rules only";
    const sample = trigger.match.slice(0, 3).join(", ");
    console.log(`  ${trigger.id.padEnd(22)} ${steps.padEnd(18)} match: ${sample}`);
  }
  console.log("\nOrchestrator steps encoded:");
  for (const key of ["6", "7", "8"]) {
    const step = map.orchestratorSteps[key];
    if (step) console.log(`  ${key}: ${step.label} — ${step.when}`);
  }
  console.log('\nUsage: npm run context:gotcha -- --task "vendor receive pin gate"');
}

function main() {
  const map = loadGotchaMap();

  if (args.includes("--list") || args.length === 0) {
    printList(map);
    process.exit(0);
  }

  const taskIdx = args.indexOf("--task");
  if (taskIdx < 0) usage();

  const task = args[taskIdx + 1];
  if (!task) {
    console.error("Missing value for --task");
    usage();
  }

  const formatIdx = args.indexOf("--format");
  const format = formatIdx >= 0 ? args[formatIdx + 1] : "json";
  if (format !== "json" && format !== "markdown") {
    console.error("Use --format json or --format markdown");
    process.exit(1);
  }

  const matched = matchTriggers(task, map.triggers);
  const result = {
    task,
    ...buildGotchaResult(matched, map.orchestratorSteps),
  };

  if (matched.length === 0) {
    result.fallback = {
      message: "No gotcha trigger match — use hot tier only (CURRENT_STATE.md + MEMORY.md)",
      hotTier: ["PROJECT_STATUS/CURRENT_STATE.md", "PROJECT_STATUS/MEMORY.md"],
    };
  }

  if (format === "markdown") {
    process.stdout.write(renderGotchaMarkdown(result));
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
