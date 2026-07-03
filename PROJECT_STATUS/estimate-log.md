# Away ship estimate log

Rolling log for the **last 15 shipped away tasks**. At `away:ship`, append one row (shift oldest off when full).

| Column | Meaning |
| ------ | ------- |
| **Away** | Item id (e.g. away-086) |
| **Budget** | Pre-ship budget minutes (from `time-awareness.mdc` calibration) |
| **Actual** | Elapsed minutes for this ship cycle |
| **Type** | Task tag: verify-only, scripts-only, ui-component, multi-file, backend, etc. |
| **Deploy** | `y` if gh-pages or backend deploy ran; `n` if commit/push only |
| **Note** | One short line — also echoed in `away:ship --note` |

| # | Away | Budget | Actual | Type | Deploy | Note |
| - | ---- | ------ | ------ | ---- | ------ | ---- |
| 1 | away-087 | 10m | 3m | verify-only | n | Verify bundle / prod checks |
| 2 | away-083 | 35m | 2m | scripts-only | n | Away tooling scripts |
| 3 | away-085 | 45m | 2m | scripts-only | n | context:packet + away:next --packet |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |
| 11 | | | | | | |
| 12 | | | | | | |
| 13 | | | | | | |
| 14 | | | | | | |
| 15 | | | | | | |
