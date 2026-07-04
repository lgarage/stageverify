# Away ship estimate log — single source of truth for away timing audit

Rolling log for the **last 15 shipped away tasks**. At ship (or docs-only completion), append one row here (shift oldest off when full). **This file is the only place** Dan approval→done-report elapsed vs budget is stored — do not duplicate timing in `away-status.json` notes or elsewhere.

Planning budgets (`time-awareness.mdc` calibration, queue item scope) stay separate; they are not actual elapsed storage.

## Type / Subtype taxonomy

Finer **Subtype** on each row enables median recalibration per slice (see **Recalibration**). Pick the narrowest fit; **Type** stays the broad tag.

| Type | Subtype | Example |
| ---- | ------- | ------- |
| verify-only | gate | readFirst / suggestion-verify gate script |
| verify-only | playwright-route | route-specific Playwright harness |
| verify-only | prod-deploy | post-gh-pages `:prod` check |
| scripts-only | cli-new | new npm CLI entry (`away:next`, `context:packet`) |
| scripts-only | pipeline-hook | ship/validate hook wiring |
| scripts-only | test-harness | fixture runner, batch test script |
| docs-update | archive-trim | dossier/history rotation |
| docs-update | status-sync | CURRENT_STATE, estimate-log, protocol sync |
| docs-update | rules-only | `.cursor/rules/` cross-ref only |
| service-logic | parser-slice | new parser module + fixtures slice |
| service-logic | parser-rule-fix | single rule/backorder/status fix |
| service-logic | parser-batch | multi-fixture batch import slice |
| service-logic | firestore-read | read-path / display helper logic |
| multi-file | parser+docs+rules | parser audit + completion table + rules |
| multi-file | cross-domain | disjoint UI + service in one ship |
| ui-component | table-action-row | dispatcher list action row styling |
| ui-component | table-rule-tighten | action-row visibility rule change |
| ui-component | drawer-section | delivery drawer section |
| ui-component | modal-copy | modal text / labels |
| ui-component | layout-style | spacing, colors, layout polish |
| ui-component | settings-email | Settings Gmail/mailbox connect UI |
| docs-update | process | estimate audit, protocol automation |

## What counts as "actual"

| Term | Meaning |
| ---- | ------- |
| **startedAt** | ISO-8601 when **Dan approves/starts** the item (`go`, `continue`, `away-NNN makes sense now`, etc.). Use `<timestamp>` from the user message when present. **`unknown`** if no approval was recorded — do not infer from agent session, first commit, or prior ship. |
| **completedAt** | ISO-8601 when the **coordinator posts the completion report** to Dan (parent session time when the task is declared done — right after **What we did**). Not the feature commit timestamp alone. |
| **actualElapsedMin** | Whole-task wall-clock minutes: `completedAt − startedAt`, **rounded to nearest minute** (no seconds precision required). Only when both timestamps exist. |
| **approx** | Prefix `~N approx` when `startedAt` is missing but elapsed was inferred during backfill — not for live ships. |
| **unknown** | No reliable approval timestamp — do **not** invent minutes; do not use Dan's subjective "felt like N minutes" or agent tool-only runtime. |

**Canonical interval:** Dan approval → completion report to Dan. Includes implementation, build, Playwright, deploy, prod verify, queue wait, and explanation write-up — the full Dan-visible task.

**NOT:** feature commit timestamp alone; agent tool-only runtime; Dan's subjective elapsed feel.

Priority when researching backfills: Dan approval message timestamp → completion report time (or best thread/subagent finish estimate) → ship commit (`git log`) for cross-ref only.

## Columns

| Column | Meaning |
| ------ | ------- |
| **Away** | Item id (e.g. away-086) |
| **startedAt** | Dan approval ISO-8601, or `unknown` |
| **completedAt** | Completion-report ISO-8601 (Dan declared done) |
| **budgetMin** | Pre-ship budget minutes (`time-awareness.mdc` calibration) |
| **actualElapsedMin** | Approval→done minutes (nearest whole minute), `unknown`, or `~N approx` (backfill only) |
| **Type** | Broad task tag: verify-only, scripts-only, ui-component, multi-file, docs-update, service-logic, backend, etc. |
| **Subtype** | Narrow slice from taxonomy above (e.g. `parser-slice`, `table-action-row`) — required at ship |
| **Deploy** | `y` if gh-pages or backend deploy ran; `n` if commit/push only |
| **Notes** | One short line — summary + methodology when approximate/unknown |

## Ship-time rule (mandatory)

At each `npm run away:ship` (see `AWAY_BUILD_PROTOCOL.md` step 6):

1. **Append one row to this file** with `startedAt`, `completedAt`, `budgetMin`, `actualElapsedMin`, **Type**, **Subtype**, deploy flag, and notes.
2. Parent/coordinator sets `startedAt` from Dan's approval message `<timestamp>` (or `unknown`).
3. Parent/coordinator sets `completedAt` when posting the **completion report** to Dan; compute `actualElapsedMin` as nearest whole minute from that interval.
4. If approval time was not tracked: `startedAt: unknown` and `actualElapsedMin: unknown` — honest beats guessed.
5. **`away:ship --note`** — short ship summary only (what shipped, verify results). Optional cross-ref: `timing: estimate-log row N`; optional `commit=<hash>`. Do **not** repeat est/actual/started/completed in the note.

Completion report (chat): **table format** after **What we did** — see `composer-orchestrator.mdc` § Completion report.

| When budget exists | Columns |
| ------------------ | ------- |
| Pre-ship budget logged | `\| \| Budget \| Actual \| Commit \|` — one row with task label, `budgetMin`, `actualElapsedMin` (or `unknown`), short commit hash |
| No budget | `\| Actual \| Commit \|` only — do **not** add a fake Budget column |

Example (budget): `| johnstone parser audit | 35 min | 12 min | a1b2c3d |`  
Example (no budget): `| 8 min | a1b2c3d |`

## Log

| # | Away | startedAt | completedAt | budgetMin | actualElapsedMin | Type | Subtype | Deploy | Notes |
| - | ---- | --------- | ----------- | --------- | ---------------- | ---- | ------- | ------ | ----- |
| 1 | away-089 | 2026-07-03T18:14:00-05:00 | 2026-07-03T18:16:58-05:00 | 35 | 3 | service-logic | parser-batch | n | Johnstone invoice Slice 2; test:invoice-batch 27/27; completedAt=92635a0 |
| 3 | dispatcher-staging-action-rows | 2026-07-03T18:34:00-05:00 | 2026-07-03T18:38:30-05:00 | 35 | 4 | ui-component | table-action-row | y | dark-orange action rows + Assign staging location; verify:delivery-consistency ORD-001/002; completedAt=6857f05 |
| 4 | dispatcher-staging-action-rows-tighten | 2026-07-03T19:52:00-05:00 | 2026-07-03T19:58:00-05:00 | 35 | 6 | ui-component | table-rule-tighten | y | missing staging alone triggers action row; offline+live verify; completedAt=136df76 |
| 5 | estimate-subtype-taxonomy | 2026-07-03T19:57:00-05:00 | 2026-07-03T19:58:13-05:00 | 10 | 1 | docs-update | status-sync | n | Subtype column + taxonomy; backfill rows 1-11; protocol/rules cross-ref; completedAt=1bcecd3 |
| 6 | away-090 | 2026-07-03T20:29:00-05:00 | 2026-07-03T20:34:17-05:00 | 35 | 5 | ui-component | drawer-copy | y | Copy pickup unreceived; verify:delivery-consistency PASS; completedAt=3f74e25 |
| 7 | away-091 | 2026-07-03T20:40:00-05:00 | 2026-07-03T20:46:00-05:00 | 35 | 6 | ui-component | drawer-copy | y | Reset Pickup Link label (was Revoke); verify:delivery-consistency PASS; commit=9ed8944 |
| 8 | estimate-timing-rule | 2026-07-03T20:49:00-05:00 | 2026-07-03T20:53:00-05:00 | 10 | 4 | docs-update | rules-only | n | Dan approval→done interval; retrofix row 14; protocol/rules/away-ship cross-ref |
| 9 | away-validate-status-sync | 2026-07-03T20:53:00-05:00 | 2026-07-03T20:59:00-05:00 | 10 | 6 | docs-update | status-sync | n | away-091 backfill; CURRENT_STATE + away-status; away:validate PASS; commit+push only |
| 10 | short-pickup-clipboard | 2026-07-03T21:03:00-05:00 | 2026-07-03T21:25:00-05:00 | 35 | 22 | ui-component | drawer-copy | y | short Copy Pickup clipboard; local 393 PASS; prod deploy skipped until redeploy |
| 11 | sonnet-3fail-escalation | 2026-07-03T21:30:00-05:00 | 2026-07-03T21:35:00-05:00 | 10 | 5 | docs-update | rules-only | n | 3-fail Sonnet diagnose-only rule; composer-orchestrator + cross-refs; away:validate PASS |
| 12 | sonnet-2fail-escalation | 2026-07-03T21:37:00-05:00 | 2026-07-03T21:43:00-05:00 | 10 | 6 | docs-update | rules-only | n | 2-fail Sonnet diagnose-only; self-trace on 1st fail; composer-orchestrator + cross-refs; build PASS |
| 13 | prod-redeploy-short-clipboard | 2026-07-03T21:37:00-05:00 | 2026-07-03T21:46:00-05:00 | 15 | 9 | verify-only | prod-deploy | y | gh-pages stale (12044c2); redeploy bundle; delivery-consistency 395/395 + phase5-email PASS |
| 14 | librarian-lessons-ssot | 2026-07-03T21:49:00-05:00 | 2026-07-03T21:58:00-05:00 | 10 | 9 | docs-update | status-sync | n | LIBRARIAN_LESSONS SSOT + gotcha triggers + MEMORY router; CURRENT_STATE away-NNN fix; away:validate PASS |
| 15 | settings-gmail-mailbox-ui | 2026-07-03T23:21:00-05:00 | 2026-07-03T23:38:00-05:00 | 35 | 17 | ui-component | settings-email | y | unified Gmail Mailbox when connected; verify:email-oauth-connect + settings-staging PASS |
| 16 | estimate-15-audit | 2026-07-03T23:24:00-05:00 | 2026-07-03T23:45:00-05:00 | 35 | 21 | docs-update | process | n | estimate:audit CLI + 15-row workflow; away:validate warn; first audit --apply |

## Audit every 15 rows (mandatory)

Every **15 completed log rows** (excluding header/template), agents run **`npm run estimate:audit`**. At **30, 45, 60…** repeat. `away:validate` warns when a milestone passed without an updated `estimate-audit.json`.

### Trigger

| Condition | Action |
| --------- | ------ |
| Row count reaches **15, 30, 45…** and `estimate-audit.json` → `lastAuditedRowCount` < milestone | Run `npm run estimate:audit` after ship (same commit as the row that hit the milestone, or immediately after) |
| `--force` | Re-run audit at current count (debug / backfill) |
| Row count < 15 | Skip — keep `time-awareness.mdc` category anchors |

**Workflow:** append estimate-log row → `npm run estimate:audit` (add `--apply` when findings recommend budget changes) → `npm run away:validate` → commit.

### What the audit computes

1. Parse all log rows; skip `actualElapsedMin: unknown` (honest gaps — do not infer).
2. Group by **Type/Subtype**; require **≥3 rows** per subtype for subtype-level stats (else fall back to **Type** only).
3. Per group: **median actual**, **median budget used**, **delta**, **recommendation**:
   - **OK** — median within ~50–85% of budget (conservative upper bound still valid).
   - **DECREASE** — median < 50% of budget → suggest lower `budgetMin` via subtype table or anchor.
   - **INCREASE** — median > 85% of budget → suggest higher `budgetMin`.
4. **Suggested budget** = `ceil(max(median×2, median+5) / 5) × 5` (same conservative rule as time-bound filter).

### Where to apply adjustments

| Data shape | Update target |
| ---------- | ------------- |
| Subtype with ≥3 rows and DECREASE/INCREASE | **Subtype budgets** table below (`estimate:audit --apply`) |
| Type fallback (no subtype quorum) maps to one `time-awareness.mdc` category row | **Category anchors** table in `time-awareness.mdc` (Budget + Typical columns) |
| Planning / away queue handoffs | Use subtype budget when present; else category anchor; else row's historical `budgetMin` |

Do **not** duplicate timing in `away-list.json`, `away-status.json`, or chat — `estimate-log.md` + `estimate-audit.json` are SSOT.

### Snapshot file

`PROJECT_STATUS/estimate-audit.json` stores `lastAuditedRowCount`, `auditedAt`, and the last report `findings[]`. Prevents re-auditing the same 15-row window every ship.

## Subtype budgets (recalibrated)

Populated by `npm run estimate:audit -- --apply` when subtype medians support a change. Agents and `away:next` briefs prefer these over generic anchors when Type/Subtype matches.

| Type | Subtype | budgetMin | typicalMin | samples | lastAuditAt | notes |
| ---- | ------- | --------- | ---------- | ------- | ----------- | ----- |
| ui-component | drawer-copy | 15 | 6 | 3 | 2026-07-04 | median 6 vs prior 35 → DECREASE |
| docs-update | rules-only | 10 | 5 | 3 | 2026-07-04 | median 5 vs prior 10 → OK (within band) |
| docs-update | status-sync | 10 | 6 | 3 | 2026-07-04 | median 6 vs prior 10 → OK |

## Recalibration (legacy pointer)

See **Audit every 15 rows** above. Subtype median vs budget; fallback to Type when subtype < 3 rows. Until first 15-row audit, use `time-awareness.mdc` category anchors only.
