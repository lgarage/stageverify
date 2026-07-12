#!/usr/bin/env node
/**
 * Thin wrapper — runs a verify script and auto-captures learnings on non-zero exit.
 * Usage: node scripts/run-verify-with-learning.mjs --script verify:pickup scripts/verify-pickup-portal.mjs [--args...]
 *
 * Set VERIFY_LEARNING_DRY_RUN=true to skip writing pending entries (for hook tests).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureVerifyFailure,
  clearPendingForScript,
  tailLines,
} from "./lib/verify-learning-hook.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function usage() {
  console.error(`Usage: node scripts/run-verify-with-learning.mjs --script <npm-script-name> <script-path> [forward-args...]

Examples:
  node scripts/run-verify-with-learning.mjs --script verify:pickup scripts/verify-pickup-portal.mjs
  node scripts/run-verify-with-learning.mjs --script verify:pickup:prod scripts/verify-pickup-portal.mjs --base-url=https://lgarage.github.io/stageverify`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const scriptIdx = args.indexOf("--script");
  if (scriptIdx < 0 || !args[scriptIdx + 1]) usage();

  const scriptName = args[scriptIdx + 1];
  let rest = [...args.slice(0, scriptIdx), ...args.slice(scriptIdx + 2)];
  const runnerIdx = rest.indexOf("--runner");
  const runner =
    runnerIdx >= 0 && rest[runnerIdx + 1] === "tsx" ? "tsx" : "node";
  if (runnerIdx >= 0) {
    rest = [...rest.slice(0, runnerIdx), ...rest.slice(runnerIdx + 2)];
  }
  const scriptPath = rest[0];
  if (!scriptPath) usage();

  const forwardArgs = rest.slice(1);
  return { scriptName, scriptPath, forwardArgs, runner };
}

/**
 * @param {string} scriptPath
 * @param {string[]} forwardArgs
 * @param {"node" | "tsx"} runner
 */
function buildSpawnCommand(scriptPath, forwardArgs, runner = "node") {
  const absPath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(REPO_ROOT, scriptPath);

  if (runner === "tsx" || scriptPath.endsWith(".ts") || scriptPath.endsWith(".tsx")) {
    return { cmd: "npx", args: ["tsx", absPath, ...forwardArgs] };
  }

  return { cmd: "node", args: [absPath, ...forwardArgs] };
}

function main() {
  const { scriptName, scriptPath, forwardArgs, runner } = parseArgs(process.argv);
  const { cmd, args } = buildSpawnCommand(scriptPath, forwardArgs, runner);

  let stdoutBuf = "";
  let stderrBuf = "";

  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: cmd === "npx" && process.platform === "win32",
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    stdoutBuf += text;
    process.stdout.write(chunk);
  });

  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuf += text;
    process.stderr.write(chunk);
  });

  child.on("close", (code) => {
    const exitCode = code ?? 1;
    const stdoutTail = tailLines(stdoutBuf);
    const stderrTail = tailLines(stderrBuf);

    if (exitCode === 0) {
      clearPendingForScript(scriptName);
      process.exit(0);
      return;
    }

    const dryRun = process.env.VERIFY_LEARNING_DRY_RUN === "true";
    captureVerifyFailure({
      scriptName,
      exitCode,
      stderrTail,
      stdoutTail,
      forwardArgs,
      dryRun,
    });

    process.exit(exitCode);
  });

  child.on("error", (err) => {
    console.error(`run-verify-with-learning: spawn failed: ${err.message}`);
    process.exit(1);
  });
}

main();
