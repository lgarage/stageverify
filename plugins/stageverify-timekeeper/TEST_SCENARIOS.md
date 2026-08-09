# Timekeeper test scenarios → decisions

Run: `node plugins/stageverify-timekeeper/tests/run.mjs`

| # | Scenario | Timekeeper decision |
| --- | --- | --- |
| 1 | Perf measurement fails twice | `thrash` + `measurement_tool_failure` — stop repeating; change method |
| 2 | 4-digit PIN mistaken for 6-digit autosubmit timeout | `thrash` + `measurement_tool_failure` — fix measurement (Verify click), one retry |
| 3 | gh-pages propagating | `wait_poll` / `deploy_propagation_wait` — bounded poll; do not restart deploy |
| 4 | main moves, PR clean | `main_clean` — material-impact check; do not redo work |
| 5 | merge conflict | `merge_conflict` — resolve only actual conflicts |
| 6 | D-38/D-60 green, later benchmark fails | Keep green stamps; classify measurement failure; do not invalidate gates |
| 7 | Impl done; measurement drags to ~25m | `focus25` completion-focus — narrow scope; no green-gate redo |
| 8 | Build/TS fails twice | `thrash` + `implementation_failure` — D-19/D-50 ladder |
| 9 | Long op still editing/progressing | No `stall10` — continue |
| 10 | ~35m, noncritical metric unavailable | `force35` — A/B/C/D; PARTIAL valid |

Example intervention:

```text
TIMEKEEPER
elapsed: ~12m
state: stalled
reason: same operation failed 2× (npm run verify:vendor-perf -- --samples 20)
new evidence last 9m: none
decision: STOP repeating this signature. Classify failure, change method, escalate per D-19/D-50, or return PARTIAL/BLOCKED.
failure_class: measurement_tool_failure
```
