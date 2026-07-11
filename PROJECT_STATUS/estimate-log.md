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

## Roles and timing (digest)

- **Worker** posts `task-start` before implementation and `task-finish` before completion report (ISO timestamps with timezone).
- **Librarian** records worker timestamps into this log at ship — never invents or backfills elapsed minutes.
- **actualElapsedMin** = timestamp math only: `round((finishedAt − startedAt) / 60s)`; missing either timestamp → `unknown`.
- **timingSource:** `worker_reported_timestamps` (calibration-safe) · `legacy_dan_approval_interval` · `unknown`.
- Hard rules: no implementation before `task-start`; no guessed Actual; math wins over worker-stated Actual when they disagree.
- Run `npm run estimate:audit` every **15 log rows** (see **Audit every 15 rows** below).

## Columns

| Column | Meaning |
| ------ | ------- |
| **Away** | Item id (e.g. away-086) |
| **startedAt** | Worker `task-start` ISO-8601, or `unknown` |
| **finishedAt** | Worker `task-finish` ISO-8601, or `unknown` |
| **budgetMin** | Pre-ship budget minutes (`time-awareness.mdc` calibration) |
| **actualElapsedMin** | `finishedAt − startedAt` (nearest whole minute), `unknown`, or legacy `~N approx` (backfill only — not calibration) |
| **timingSource** | `worker_reported_timestamps` · `legacy_dan_approval_interval` · `unknown` |
| **Type** | Broad task tag: verify-only, scripts-only, ui-component, multi-file, docs-update, service-logic, backend, etc. |
| **Subtype** | Narrow slice from taxonomy above (e.g. `parser-slice`, `table-action-row`) — required at ship |
| **Deploy** | `y` if gh-pages or backend deploy ran; `n` if commit/push only |
| **Notes** | One short line — summary; timing anomaly if worker Actual ≠ math; optional `impl=N totalWall=N` |

## Log

| # | Away | startedAt | finishedAt | budgetMin | actualElapsedMin | timingSource | Type | Subtype | Deploy | Notes |
| - | ---- | --------- | ---------- | --------- | ---------------- | ------------ | ---- | ------- | ------ | ----- |
| 1 | away-089 | 2026-07-03T18:14:00-05:00 | 2026-07-03T18:16:58-05:00 | 35 | 3 | legacy_dan_approval_interval | service-logic | parser-batch | n | Johnstone invoice Slice 2; test:invoice-batch 27/27; completedAt=92635a0 |
| 3 | dispatcher-staging-action-rows | 2026-07-03T18:34:00-05:00 | 2026-07-03T18:38:30-05:00 | 35 | 5 | legacy_dan_approval_interval | ui-component | table-action-row | y | dark-orange action rows + Assign staging location; verify:delivery-consistency ORD-001/002; completedAt=6857f05 |
| 4 | dispatcher-staging-action-rows-tighten | 2026-07-03T19:52:00-05:00 | 2026-07-03T19:58:00-05:00 | 35 | 6 | legacy_dan_approval_interval | ui-component | table-rule-tighten | y | missing staging alone triggers action row; offline+live verify; completedAt=136df76 |
| 5 | estimate-subtype-taxonomy | 2026-07-03T19:57:00-05:00 | 2026-07-03T19:58:13-05:00 | 10 | 1 | legacy_dan_approval_interval | docs-update | status-sync | n | Subtype column + taxonomy; backfill rows 1-11; protocol/rules cross-ref; completedAt=1bcecd3 |
| 6 | away-090 | 2026-07-03T20:29:00-05:00 | 2026-07-03T20:34:17-05:00 | 35 | 5 | legacy_dan_approval_interval | ui-component | drawer-copy | y | Copy pickup unreceived; verify:delivery-consistency PASS; completedAt=3f74e25 |
| 7 | away-091 | 2026-07-03T20:40:00-05:00 | 2026-07-03T20:46:00-05:00 | 35 | 6 | legacy_dan_approval_interval | ui-component | drawer-copy | y | Reset Pickup Link label (was Revoke); verify:delivery-consistency PASS; commit=9ed8944 |
| 8 | estimate-timing-rule | 2026-07-03T20:49:00-05:00 | 2026-07-03T20:53:00-05:00 | 10 | 4 | legacy_dan_approval_interval | docs-update | rules-only | n | Dan approval→done interval; retrofix row 14; protocol/rules/away-ship cross-ref |
| 9 | away-validate-status-sync | 2026-07-03T20:53:00-05:00 | 2026-07-03T20:59:00-05:00 | 10 | 6 | legacy_dan_approval_interval | docs-update | status-sync | n | away-091 backfill; CURRENT_STATE + away-status; away:validate PASS; commit+push only |
| 10 | short-pickup-clipboard | 2026-07-03T21:03:00-05:00 | 2026-07-03T21:25:00-05:00 | 35 | 22 | legacy_dan_approval_interval | ui-component | drawer-copy | y | short Copy Pickup clipboard; local 393 PASS; prod deploy skipped until redeploy |
| 11 | sonnet-3fail-escalation | 2026-07-03T21:30:00-05:00 | 2026-07-03T21:35:00-05:00 | 10 | 5 | legacy_dan_approval_interval | docs-update | rules-only | n | 3-fail Sonnet diagnose-only rule; composer-orchestrator + cross-refs; away:validate PASS |
| 12 | sonnet-2fail-escalation | 2026-07-03T21:37:00-05:00 | 2026-07-03T21:43:00-05:00 | 10 | 6 | legacy_dan_approval_interval | docs-update | rules-only | n | 2-fail Sonnet diagnose-only; self-trace on 1st fail; composer-orchestrator + cross-refs; build PASS |
| 13 | prod-redeploy-short-clipboard | 2026-07-03T21:37:00-05:00 | 2026-07-03T21:46:00-05:00 | 15 | 9 | legacy_dan_approval_interval | verify-only | prod-deploy | y | gh-pages stale (12044c2); redeploy bundle; delivery-consistency 395/395 + phase5-email PASS |
| 14 | librarian-lessons-ssot | 2026-07-03T21:49:00-05:00 | 2026-07-03T21:58:00-05:00 | 10 | 9 | legacy_dan_approval_interval | docs-update | status-sync | n | LIBRARIAN_LESSONS SSOT + gotcha triggers + MEMORY router; CURRENT_STATE away-NNN fix; away:validate PASS |
| 15 | settings-gmail-mailbox-ui | 2026-07-03T23:21:00-05:00 | 2026-07-03T23:38:00-05:00 | 35 | 17 | legacy_dan_approval_interval | ui-component | settings-email | y | unified Gmail Mailbox when connected; verify:email-oauth-connect + settings-staging PASS |
| 16 | estimate-15-audit | 2026-07-03T23:24:00-05:00 | 2026-07-03T23:45:00-05:00 | 35 | 21 | legacy_dan_approval_interval | docs-update | process | n | estimate:audit CLI + 15-row workflow; away:validate warn; first audit --apply |
| 17 | deploy-pages-poll-gate | unknown | 2026-07-04T00:35:00-05:00 | 35 | unknown | unknown | scripts-only | pipeline-hook | y | deploy-gh-pages.mjs polls Pages build + live bundle; ship-loop + lesson; verify:email-oauth-connect:prod PASS |
| 18 | away-092 | 2026-07-04T01:17:00-05:00 | 2026-07-04T01:25:00-05:00 | 35 | 8 | legacy_dan_approval_interval | service-logic | parser-slice | y | parsedLines Table B on vendorInvoiceImports; verify:inbound-email-ingest PASS; commit=5a57fc2 |
| 19 | away-093 | 2026-07-04T01:25:00-05:00 | 2026-07-04T01:35:00-05:00 | 35 | 10 | legacy_dan_approval_interval | service-logic | firestore-read | y | matchInvoiceToRecords callable + emulator test; commit=58f392d |
| 20 | away-094 | 2026-07-04T01:35:00-05:00 | 2026-07-04T01:50:00-05:00 | 50 | 15 | legacy_dan_approval_interval | service-logic | firestore-read | y | approveVendorInvoiceImport CF; Sonnet MEDIUM reject txn fix; test PASS; commit=518a0a1 |
| 21 | away-095 | 2026-07-04T01:50:00-05:00 | 2026-07-04T02:05:00-05:00 | 35 | 15 | legacy_dan_approval_interval | ui-component | table-action-row | y | /invoice-review queue + match picker + approve/reject; verify:dispatcher-nav PASS; commit=c00d4a9; timing anomaly corrected (was 25) |
| 22 | away-096 | 2026-07-04T02:05:00-05:00 | 2026-07-04T02:22:00-05:00 | 35 | 17 | legacy_dan_approval_interval | service-logic | firestore-read | y | dispatcher auth + sanitize list + stranded recovery txn; verify:inbound-email-ingest PASS; commit=80163b1 |
| 23 | away-097 | 2026-07-04T02:22:00-05:00 | 2026-07-04T02:30:00-05:00 | 35 | 8 | legacy_dan_approval_interval | verify-only | playwright-route | y | verify-invoice-review + :prod PASS; commit=3875f4d |
| 24 | away-098 | 2026-07-04T02:30:00-05:00 | 2026-07-04T02:38:00-05:00 | 20 | 8 | legacy_dan_approval_interval | docs-update | process | n | gotcha triggers + lessons index hygiene; away:validate PASS |
| 25 | away-task-timing-protocol | 2026-07-04T08:29:00-05:00 | 2026-07-04T08:33:00-05:00 | 35 | 4 | worker_reported_timestamps | docs-update | process | n | worker-owned timing protocol; away:validate timing checks; legacy row math fixes |
| 26 | away-124 | 2026-07-11T04:54:08Z | 2026-07-11T04:56:02Z | 35 | 2 | worker_reported_timestamps | verify-only | playwright-route | n | remount+auth Scenario A; verify:pickup PASS; harness readiness/invoice/email/pickup-authority/evidence PASS |
| 27 | away-125 | 2026-07-11T04:57:45Z | 2026-07-11T04:58:56Z | 35 | 1 | worker_reported_timestamps | docs-update | status-sync | n | mechanical lint 85→59; skip auth/react-refresh/renders; build+invoice+readiness PASS |

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

1. Parse all log rows; skip `actualElapsedMin: unknown`, `~N approx`, and rows where `timingSource` ≠ `worker_reported_timestamps` (legacy rows excluded from calibration — honest gaps, do not infer).
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
