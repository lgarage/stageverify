# StageVerify Timekeeper

Small Cursor harness plugin that reduces wall-clock and model-cost thrash inside each StageVerify agent run.

## What it is

- **Cursor Plugin** (`plugins/stageverify-timekeeper/`) with hooks + alwaysApply rule + lightweight skill
- **Auto-active in this repo** via project `.cursor/hooks.json` (cloud agents load project hooks)
- **Advise-only** — never denies tools/shell for thrash; never weakens D-38/D-60/D-50/D-66/D-69

## Caps discovered (Cursor APIs)

| Capability | Supported? | How Timekeeper uses it |
| --- | --- | --- |
| Task / session start time | Partial | Lazy `startedAt` on first hook (`sessionStart` unavailable in cloud) |
| Elapsed wall-clock | Derived | Disk state keyed by `conversation_id` |
| Command start/end + duration | Yes | `before/afterShellExecution`, `postToolUse` `duration` |
| Command exit status | **No** (shell) | Heuristics on `output` / `postToolUseFailure.failure_type` |
| Timeout events | Yes | `postToolUseFailure.failure_type = timeout` |
| Tool-call history | Partial | Per-conversation signature map on disk |
| Repeated command signatures | Derived | Normalized command signatures |
| Subagent lifecycle | Yes | `subagentStart` / `subagentStop` |
| Transcript path | Yes (field) | Received; not parsed in v1 |
| PR/branch state | Partial | `subagentStart.git_branch`; shell `git` output heuristics |
| Supervise another Cloud Agent | **No** | In-run only |

## Delivery reliability (D-72 amend)

| Hook | Inject field | Reliability |
| --- | --- | --- |
| `postToolUse` | `additional_context` | **Reliable** — mark delivered |
| `preToolUse` | `agent_message` (+ `permission: allow`) | **Reliable** — mark delivered |
| `beforeShellExecution` | `agent_message` (+ `permission: allow`) | **Reliable** — mark delivered |
| `stop` | `followup_message` | **Reliable** — mark delivered |
| `afterShellExecution` / `afterFileEdit` / `postToolUseFailure` / subagent hooks | best-effort / none | **Unreliable** — queue `pending` only |

Platform does not ack model receipt — “delivered” means the response included an agent-visible advice field (strongest deterministic approximation).

**Multi-pending elapsed policy B:** emit the highest due elapsed checkpoint only; mark lower pending as `superseded`.

## Cadence

Elapsed (not suppressed by healthy progress): ~10 / 15 / 20 / 25 / 30 / 35m.  
After `force35` delivered: sticky D-66 re-nudge on reliable hooks every **~5m** until DONE/BLOCKED/FAILED/PARTIAL; `stop` re-issues followup while `force_choice` (respects `loop_limit`).  
Stall: ~10m with **no** material progress. Thrash: same signature fail×2 → D-19/D-50.

## Install / activation

1. **StageVerify repo (default):** commit includes `.cursor/hooks.json` → cloud + trusted IDE runs pick it up automatically.
2. **IDE plugin install (optional):** Customize → add this folder as a Cursor Plugin (manifest `.cursor-plugin/plugin.json`).

State + optional `trace.jsonl` (gitignored): `.cursor/hooks/state/timekeeper/`

## Test

```bash
node plugins/stageverify-timekeeper/tests/run.mjs
```

## Overhead

Each hooked event: one Node process, read/write a small JSON state file. Typical <50ms. Messages only on intervention.
