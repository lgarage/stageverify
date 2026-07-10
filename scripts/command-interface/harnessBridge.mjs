/**
 * Bridge to existing harness state — repository remains source of truth.
 */
import { execSync } from "node:child_process";
import {
  PATHS,
  REPO_ROOT,
  readJson,
  readText,
  writeJson,
} from "../lib/away-memory-lib.mjs";
import { formatClarification, formatDigest, formatPlain } from "./responseFormatter.mjs";

/** @typedef {import('./types.mjs').RoutedIntent} RoutedIntent */
/** @typedef {import('./types.mjs').FormattedResponse} FormattedResponse */

/**
 * @param {string} md
 * @param {string} heading
 */
function extractSection(md, heading) {
  const re = new RegExp(
    `## ${heading}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n## |$)`,
    "i",
  );
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

/**
 * @param {string} md
 */
function extractSnapshotBullets(md) {
  const snap = extractSection(md, "Snapshot");
  return snap
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function gitOneLiner(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/**
 * @returns {import('./types.mjs').CommandInterfaceControl}
 */
export function readControl() {
  const list = readJson(PATHS.awayList);
  const ci = list.executionProtocol?.commandInterface ?? {};
  return {
    paused: Boolean(ci.paused),
    pauseAfterCurrentTask: Boolean(ci.pauseAfterCurrentTask),
    updatedAt: ci.updatedAt,
    lastSlackTs: ci.lastSlackTs,
  };
}

/**
 * @param {Partial<import('./types.mjs').CommandInterfaceControl>} patch
 */
export function writeControl(patch) {
  const list = readJson(PATHS.awayList);
  const prev = list.executionProtocol?.commandInterface ?? {};
  list.executionProtocol = list.executionProtocol ?? {};
  list.executionProtocol.commandInterface = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(PATHS.awayList, list);
}

/**
 * @param {string} [lastTs]
 */
export function rememberLastSlackTs(lastTs) {
  if (!lastTs) return;
  writeControl({ lastSlackTs: lastTs });
}

/**
 * @returns {string | undefined}
 */
export function getLastSlackTs() {
  return readControl().lastSlackTs;
}

/**
 * @param {RoutedIntent} intent
 * @returns {Promise<FormattedResponse>}
 */
export async function executeIntent(intent) {
  const control = readControl();
  const stateMd = readText(PATHS.currentState);
  const awayList = readJson(PATHS.awayList);
  const awayStatus = readJson(PATHS.awayStatus);
  const head = gitOneLiner("git rev-parse --short HEAD");
  const branch = gitOneLiner("git branch --show-current");

  switch (intent.type) {
    case "unsupported":
      return formatPlain(
        "That action needs an active Cursor session with Dan approval.\n\nDONE: Command interface is read + control only (Phase 0).\nNOW: Deploy, implement, and high-risk CF work stay in the harness ship loop.\nDECIDE: Open Cursor or reply here with a status question.\nNEXT: Examples: \"What's blocking us?\" or \"What review failed?\"",
        "unsupported",
      );

    case "pause": {
      if (intent.pauseAfterCurrentTask) {
        writeControl({ pauseAfterCurrentTask: true, paused: false });
        return formatDigest(
          {
            DONE: "Pause-after-current-task recorded in away-list executionProtocol.",
            NOW: "Active work may finish the current task, then should halt.",
            DECIDE: "—",
            NEXT: "Say *Continue* or *Resume* to clear the pause flag.",
          },
          "pause",
        );
      }
      writeControl({ paused: true, pauseAfterCurrentTask: false });
      return formatDigest(
        {
          DONE: "Pause flag set (away-list executionProtocol.commandInterface).",
          NOW: "Away batch / new implementation should not start until resumed.",
          DECIDE: "—",
          NEXT: "Say *Continue* when ready.",
        },
        "pause",
      );
    }

    case "resume": {
      writeControl({ paused: false, pauseAfterCurrentTask: false });
      return formatDigest(
        {
          DONE: "Pause flags cleared.",
          NOW: extractSection(stateMd, "Immediate Next Step").split("\n")[0]?.replace(/^-\s*/, "") ?? "See CURRENT_STATE.md.",
          DECIDE: "—",
          NEXT: "Harness may proceed per ship loop.",
        },
        "resume",
      );
    }

    case "status": {
      const bullets = extractSnapshotBullets(stateMd);
      const pausedNote = control.paused
        ? "Command interface PAUSED."
        : control.pauseAfterCurrentTask
          ? "Pause after current task is SET."
          : "Command interface active.";
      return formatDigest(
        {
          DONE: bullets[4]?.replace(/^Last shipped:\s*/i, "") ?? `At ${head}`,
          NOW: bullets[0]?.replace(/^Active Phase:\s*/i, "") ?? "See CURRENT_STATE.md",
          DECIDE: pausedNote,
          NEXT: extractSection(stateMd, "Immediate Next Step").replace(/^-\s*\*\*Product:\*\*\s*/i, "").slice(0, 280),
        },
        "status",
      );
    }

    case "blockers": {
      const blockers = extractSection(stateMd, "Active Blockers")
        .split("\n")
        .map((l) => l.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean);
      return formatDigest(
        {
          DONE: `Branch ${branch} @ ${head}`,
          NOW: blockers.slice(0, 3).join(" · ") || "No blockers listed.",
          DECIDE: blockers[3] ?? "—",
          NEXT: blockers.length > 4 ? blockers.slice(4).join(" · ") : extractSection(stateMd, "Immediate Next Step").slice(0, 200),
        },
        "blockers",
      );
    }

    case "phase_summary": {
      const bullets = extractSnapshotBullets(stateMd);
      return formatDigest(
        {
          DONE: "Location-first transition — Phase 3 complete.",
          NOW: bullets[0]?.replace(/^Active Phase:\s*/i, "") ?? "Phase 4 in progress",
          DECIDE: "Phase 4 release-prompt CF awaits Dan approval (high-risk).",
          NEXT: "Vendor pilot after Phase 4 + shop map + Jake shelving.",
        },
        "phase_summary",
      );
    }

    case "review_failed": {
      const recent = Array.isArray(awayStatus.results)
        ? awayStatus.results.slice(-3)
        : [];
      const notes = recent.map((r) => `${r.id}: ${r.status}`).join("; ");
      return formatDigest(
        {
          DONE: "No open review FAIL recorded in away-status.",
          NOW: "Last ships: " + (notes || (awayStatus.summary ?? "see away-status.json")),
          DECIDE: "Ship-verifier + Sonnet gate run inside Cursor sessions — check completion report lines there.",
          NEXT: "If a gate failed tonight, paste the task-id or say \"What changed?\"",
        },
        "review_failed",
      );
    }

    case "what_changed": {
      const log = gitOneLiner("git log -5 --oneline");
      return formatDigest(
        {
          DONE: log.split("\n")[0] ?? head,
          NOW: log.split("\n").slice(1, 3).join(" · ") || "—",
          DECIDE: "—",
          NEXT: "Full history: git log on main.",
        },
        "what_changed",
      );
    }

    case "next_decision": {
      const next = extractSection(stateMd, "Immediate Next Step");
      return formatDigest(
        {
          DONE: "Harness V1 freeze — additions need pain tickets.",
          NOW: "Highest ROI: Phase 4 release-prompt CF approval.",
          DECIDE: next.includes("await Dan approval")
            ? "Approve Phase 4 CF + push-ingest fix tier (both high-risk)."
            : "See Immediate Next Step in CURRENT_STATE.md.",
          NEXT: "Dan-side: shop map, Jake shelving, Gmail topic config.",
        },
        "next_decision",
      );
    }

    case "explain_wait": {
      const queue = awayList.queue?.filter((q) => q.status !== "blocked") ?? [];
      const blocked = awayList.queue?.filter((q) => q.status === "blocked") ?? [];
      const reason = control.paused
        ? "Command interface pause flag is set."
        : queue.length === 0
          ? "Away queue empty — waiting on Dan approval or Dan-side blockers."
          : `Runnable queue item: ${queue[0]?.id ?? "none"}`;
      return formatDigest(
        {
          DONE: awayStatus.summary ?? "See away-status.json",
          NOW: reason,
          DECIDE: blocked.length ? `Blocked: ${blocked.map((b) => b.id).join(", ")}` : "—",
          NEXT: "Say *Continue* to clear pause, or ask *What's blocking us?*",
        },
        "explain_wait",
      );
    }

    case "help":
      return formatPlain(
        "Phase 0 command interface — natural language, no slash commands.\n\nTry:\n• What are you working on?\n• What's blocking us?\n• Summarize the current phase.\n• What review failed?\n• What changed?\n• Pause / Continue\n• Stop after this task\n• What's the next decision?\n\nDONE: Reads CURRENT_STATE + away-list + git.\nNOW: Slack is transport #1 only.\nDECIDE: Build/deploy/high-risk needs Cursor + your approval.\nNEXT: Dictate from iPhone speech-to-text in Slack.",
        "help",
      );

    case "clarify":
    default:
      return formatClarification([
        "What are you working on?",
        "What's blocking us?",
        "Pause / Continue",
        "What review failed?",
      ]);
  }
}

/**
 * Progress events for meaningful updates only (not chatty).
 * @param {'task_started' | 'review_running' | 'repair_required' | 'repair_complete' | 'waiting_approval' | 'completed' | 'listening'} event
 * @param {string} [detail]
 */
export function formatProgressEvent(event, detail = "") {
  const labels = {
    task_started: "Task started",
    review_running: "Review running",
    repair_required: "Repair required",
    repair_complete: "Repair complete",
    waiting_approval: "Waiting for approval",
    completed: "Completed",
    listening: "Command interface listening",
  };
  const label = labels[event] ?? event;
  return detail ? `${label}: ${detail}` : label;
}
