#!/usr/bin/env node
/**
 * Phase 0 Slack command interface listener.
 *
 * Manual setup (.env.local):
 *   STAGEVERIFY_SLACK_BOT_TOKEN=xoxb-...   (same bot as user-slack MCP)
 *   STAGEVERIFY_SLACK_CHANNEL_ID=C0B43DJPMS7
 *   STAGEVERIFY_SLACK_BOT_USER_ID=U0B3UBNHRK9  (optional — skip own messages)
 *   STAGEVERIFY_SLACK_ALLOWED_USER_IDS=U0B47NC4A9L  (comma-separated; default Dan only)
 *
 * Run before driving:
 *   npm run command:slack
 *
 * Poll interval default 8s (override: STAGEVERIFY_COMMAND_POLL_MS=8000)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTransport } from "./command-interface/transportRegistry.mjs";
import { runLoop } from "./command-interface/orchestrator.mjs";

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const pollMs = Number.parseInt(
  process.env.STAGEVERIFY_COMMAND_POLL_MS ?? "8000",
  10,
);

const transport = createTransport("slack");

console.log(`[command] Slack transport starting (poll ${pollMs}ms)`);

const stop = await runLoop(transport, pollMs);

process.on("SIGINT", () => {
  console.log("[command] shutting down");
  stop();
  process.exit(0);
});
