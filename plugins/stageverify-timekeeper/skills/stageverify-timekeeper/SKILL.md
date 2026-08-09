---
name: stageverify-timekeeper
description: Anti-thrash timekeeping for StageVerify harness runs. Use when stalled, repeating failed measurements, waiting on CI/deploy, or past ~10–35 minutes wall-clock.
---

# StageVerify Timekeeper skill

## When to use

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

## Non-goals

- Not a cross-agent supervisor
- Not a replacement for D-19/D-50
- Not permission to skip required safety/verify gates
- Not a reason to interrupt healthy active tool/subagent work — checkpoints arrive at the next eligible hook
