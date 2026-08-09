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

## Install / activation

1. **StageVerify repo (default):** commit includes `.cursor/hooks.json` → cloud + trusted IDE runs pick it up automatically.
2. **IDE plugin install (optional):** Customize → add this folder as a Cursor Plugin (manifest `.cursor-plugin/plugin.json`).

State files (gitignored): `.cursor/hooks/state/timekeeper/*.json`

## Test

```bash
node plugins/stageverify-timekeeper/tests/run.mjs
```

## Overhead

Each hooked event: one Node process, read/write a small JSON state file. Typical <50ms. Messages only on intervention.
