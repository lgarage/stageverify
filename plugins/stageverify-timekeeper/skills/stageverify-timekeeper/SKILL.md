---
name: stageverify-timekeeper
description: "DISABLED (Dan 2026-10-14) — D-72 Timekeeper off; ignore TIMEKEEPER blocks."
---

# DISABLED — StageVerify Timekeeper skill (Dan 2026-10-14)

D-72 Timekeeper is **turned off** (project hooks cleared). Do **not** invoke this skill or honor `TIMEKEEPER` hook output. Archived text below.

# StageVerify Timekeeper skill (archived)

## When to use (inactive)

- Same verify/benchmark/command failed twice
- Waiting on gh-pages / Firebase / CI
- Main moved under a PR
- Session elapsed past ~10 / 15 / 20 / 25 / 30 / 35 minutes with incomplete DONE

## Protocol

1. Read any `TIMEKEEPER` block injected by hooks — follow its `decision`.
2. Classify failure (`measurement_tool_failure` vs product/implementation/verification/wait/drift).
3. Do not blind-retry. Prefer one corrected method.
4. Preserve already-green D-38 / D-60 / build / visual evidence unless code/base made it stale.
5. At ~35m emit D-66 terminal status (DONE / BLOCKED / FAILED / PARTIAL).
6. After ~35m, honor sticky re-nudges (~every 5m) and stop followups: stop expanding scope, finish the current safe unit, return D-66, hand off remainder. Waiting on Dan → BLOCKED; external wait → BLOCKED/PARTIAL; do not chase unrelated issues. Do not skip required gates for time pressure.

## Non-goals

- Not a cross-agent supervisor
- Not a replacement for D-19/D-50
- Not permission to skip required safety/verify gates
- Not a reason to interrupt healthy active tool/subagent work — checkpoints arrive at the next eligible hook
- Not a tool/agent killer — advise-only even after force35
