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
| 7 | Impl done; measurement drags to ~25m | `focus25` completion-focus |
| 8 | Build/TS fails twice | `thrash` + `implementation_failure` — D-19/D-50 ladder |
| 9 | Long op still editing/progressing | No `stall10` — continue (elapsed checkpoints still fire) |
| 10 | ~35m | `force35` — D-66 DONE/BLOCKED/FAILED/PARTIAL |
| A–G | Healthy 9–36m cadence | `status10`→`focus15`→`focus20`→`focus25`→`completion30`→`force35` once each |
| H–K | Pending/delivered + supersession | Due on unreliable → pending; reliable delivers; multi-pending emits highest |
| L–P | Thrash/stall/wait/reset/fail-open | Same delivery mechanism; conversation reset; never deny |
| Q–Z | Sticky post-35m | Cooldown ~5m; stop re-followup; terminal suppresses; advise-only allow |

Example intervention (elapsed):

```text
TIMEKEEPER 20m — still progressing? Continue the shortest safe path and do not redo green work.
HARD CONTRACT: Never skip required D-38/D-60/D-42/D-51/verify:* / D-50 ladders. Timekeeper complements; it does not weaken safety.
```
