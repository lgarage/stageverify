# Away ship estimate log

Rolling log for the **last 15 shipped away tasks**. At `away:ship`, append one row (shift oldest off when full). **Source of truth** — no JSON schema in `away-status.json` yet.

## What counts as "actual"

| Term | Meaning |
| ---- | ------- |
| **startedAt** | ISO-8601 when **Dan approves/starts** the item (`go`, `continue`, `away-NNN makes sense now`, etc.). Use `<timestamp>` from the user message when present. **`unknown`** if no approval was recorded — do not infer from agent session, first commit, or prior ship. |
| **completedAt** | ISO-8601 of the **last commit/push** for that away item (`git show -s --format=%cI <hash>` on the ship commit). |
| **actualElapsedMin** | Wall-clock minutes: `completedAt − startedAt`. Only when both timestamps exist. |
| **approx** | Prefix `~N approx` when `startedAt` is missing but elapsed was inferred from commit chain during backfill — not for live ships. |
| **unknown** | No reliable approval timestamp — do **not** invent minutes; do not use Dan's observed runtime or guessed agent duration. |

**Canonical interval:** Dan approval → last ship commit. Agent tool time and Dan's subjective "felt like N minutes" are irrelevant.

Priority when researching backfills: Dan approval message timestamp → ship commit (`git log`) → `away-status` `--note` → prior estimate-log rows.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Away** | Item id (e.g. away-086) |
| **startedAt** | Dan approval ISO-8601, or `unknown` |
| **completedAt** | Last ship-commit ISO-8601 |
| **budgetMin** | Pre-ship budget minutes (`time-awareness.mdc` calibration) |
| **actualElapsedMin** | Approval→commit minutes, `unknown`, or `~N approx` (backfill only) |
| **Type** | Task tag: verify-only, scripts-only, ui-component, multi-file, docs-update, backend, etc. |
| **Deploy** | `y` if gh-pages or backend deploy ran; `n` if commit/push only |
| **Notes** | One short line — summary + methodology when approximate/unknown |

## Ship-time rule (mandatory)

At each `npm run away:ship`, record in this log **and** echo key fields in `--note` (see `AWAY_BUILD_PROTOCOL.md`):

- Parent/coordinator sets `startedAt` from Dan's approval message (or `unknown`)
- Executor sets `completedAt` from the ship commit hash (`git show -s --format=%cI`)
- `budgetMin`, `actualElapsedMin`, task tag, deploy flag, notes
- If approval time was not tracked: `startedAt: unknown` and `actualElapsedMin: unknown` — honest beats guessed

**`--note` string format** (parsed by humans only; stored verbatim in `away-status.json`):

```
started:<ISO|unknown> completed:<ISO> est:<N>m actual:<N>m|unknown tag:<type> deploy:y|n <summary>
```

Example:

```
started:2026-07-03T14:59:00-05:00 completed:2026-07-03T15:02:04-05:00 est:35m actual:3m tag:scripts-only deploy:n gotcha map + context:gotcha CLI
```

## Log

| # | Away | startedAt | completedAt | budgetMin | actualElapsedMin | Type | Deploy | Notes |
| - | ---- | --------- | ----------- | --------- | ---------------- | ---- | ------ | ----- |
| 1 | away-087 | unknown | 2026-07-03T14:25:51-05:00 | 10 | unknown | verify-only | n | readFirst svscope gate; completedAt=eeba32e; no Dan approval logged |
| 2 | away-083 | unknown | 2026-07-03T14:30:50-05:00 | 35 | unknown | scripts-only | n | project_state sync on ship/validate; completedAt=01079aa; no approval logged |
| 3 | away-085 | unknown | 2026-07-03T14:37:28-05:00 | 45 | unknown | scripts-only | n | context:packet + away:next --packet; completedAt=4626672; no approval logged |
| 4 | away-086 | unknown | 2026-07-03T14:49:18-05:00 | 35 | unknown | docs-update | n | Dossier cold-table rotation; completedAt=83c59eb; no approval logged |
| 5 | away-084 | 2026-07-03T14:59:00-05:00 | 2026-07-03T15:02:04-05:00 | 35 | 3 | scripts-only | n | Dan: "away-084 makes sense now" after ~2:59 PM scout; completedAt=2ca348a (feat 4b2ca83) |
| 6 | | | | | | | | |
| 7 | | | | | | | | |
| 8 | | | | | | | | |
| 9 | | | | | | | | |
| 10 | | | | | | | | |
| 11 | | | | | | | | |
| 12 | | | | | | | | |
| 13 | | | | | | | | |
| 14 | | | | | | | | |
| 15 | | | | | | | | |

## Recalibration (after 15 rows)

When this log holds **15 rows** with honest approval→commit timing, the orchestrator recalibrates **`budgetMin`** in `away-list.json` / handoff briefs by **task tag** (`verify-only`, `scripts-only`, `docs-update`, etc.) using median actual vs prior budget. Until then, keep using `time-awareness.mdc` calibration anchors.
