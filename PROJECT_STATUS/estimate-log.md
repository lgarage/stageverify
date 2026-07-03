# Away ship estimate log

Rolling log for the **last 15 shipped away tasks**. At `away:ship`, append one row (shift oldest off when full). **Source of truth** — no JSON schema in `away-status.json` yet.

## What counts as "actual"

| Term | Meaning |
| ---- | ------- |
| **Wall-clock elapsed** | `startedAt` → `completedAt` (ship timestamp). Preferred when both exist. |
| **Active agent runtime** | Only when explicit tool/session timestamps show execution — rare; note in **Notes**. |
| **approximate** | Inferred from git commit times or prior ship commit — mark in **actualElapsedMin** or **Notes**. |
| **unknown** | No reliable start timestamp — do **not** invent minutes. |

Priority when researching backfills: git commits → `away-status` notes → prior estimate-log rows → session notes → `startedAt`/`completedAt` fields if present.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Away** | Item id (e.g. away-086) |
| **startedAt** | ISO-8601 when work on this item began (agent session or first related commit). `unknown` if missing. |
| **completedAt** | ISO-8601 when item shipped (`away:ship` / ship commit). |
| **budgetMin** | Pre-ship budget minutes (`time-awareness.mdc` calibration). |
| **actualElapsedMin** | Wall-clock minutes start→complete, or `unknown` / `~N approx` when inferred from commits. |
| **Type** | Task tag: verify-only, scripts-only, ui-component, multi-file, docs-update, backend, etc. |
| **Deploy** | `y` if gh-pages or backend deploy ran; `n` if commit/push only |
| **Notes** | One short line — summary + methodology when approximate/unknown |

## Ship-time rule (mandatory)

At each `npm run away:ship`, record in this log **and** echo key fields in `--note` (see `AWAY_BUILD_PROTOCOL.md`):

- `startedAt`, `completedAt`, `budgetMin`, `actualElapsedMin`, task tag, deploy flag, notes
- If start time was not tracked, use `startedAt: unknown` and `actualElapsedMin: unknown` — honest beats guessed.

**`--note` string format** (parsed by humans only; stored verbatim in `away-status.json`):

```
started:<ISO|unknown> completed:<ISO> est:<N>m actual:<N>m|unknown tag:<type> deploy:y|n <summary>
```

Example:

```
started:2026-07-03T14:37:28-05:00 completed:2026-07-03T14:49:18-05:00 est:35m actual:12m tag:docs-update deploy:n rotate cold dossier § to archive
```

## Log

| # | Away | startedAt | completedAt | budgetMin | actualElapsedMin | Type | Deploy | Notes |
| - | ---- | --------- | ----------- | --------- | ---------------- | ---- | ------ | ----- |
| 1 | away-087 | unknown | 2026-07-03T14:25:51-05:00 | 10 | unknown | verify-only | n | Verify readFirst excludes svscope unless scopeDispute; verify-only, no start logged |
| 2 | away-083 | unknown | 2026-07-03T14:30:50-05:00 | 35 | unknown | scripts-only | n | away:ship + validate sync project_state; no reliable start timestamp |
| 3 | away-085 | 2026-07-03T14:30:50-05:00 | 2026-07-03T14:37:28-05:00 | 45 | ~7 approx | scripts-only | n | context:packet + away:next --packet; start=away-083 feat commit |
| 4 | away-086 | 2026-07-03T14:37:28-05:00 | 2026-07-03T14:49:18-05:00 | 35 | ~12 approx | docs-update | n | Dossier cold-table rotation; elapsed from ship commits after away-085 |
| 5 | | | | | | | | |
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
