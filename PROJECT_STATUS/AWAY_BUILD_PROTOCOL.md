# Away / agent build protocol (stageverify)

> Canonical instructions for running `away-list.json` batches and substantive agent builds in this repo.
> Rules detail: `.cursor/rules/composer-orchestrator.mdc`, `parallel-agent-strategy.mdc`, `ship-loop.mdc`.

## Session start

**Authoritative:** `.cursor/rules/composer-orchestrator.mdc` § Session Start (hot tier STOP + on-demand steps 3–8). Away-specific on-demand reads: **`npm run away:next`** (canonical next brief), `svscope_simple.md` (scope disputes), `MODEL_DOSSIER.md` § **agent-lessons** (UI/pickup/receive/vendor).

## Away / sleep workflow (4 phases — Dan confirmed order)

**Plan → Approve → Queue → Execute.** Plan/approve/queue can run any time of day (`time-awareness.mdc`); execute-batch triggers include sleep/overnight — same protocol, not roadmap.

| Phase | Dan trigger phrases | Agent action |
| ----- | ------------------- | -------------- |
| **1 Plan** | `what should I build while I'm away`, `while I sleep`, `overnight batch`, `run while I'm away`, first away/sleep question | **`npm run away:plan`** — return `queuedItems` + optional `suggestedAdditions` (drafts). **Do not write `away-list.json`.** Do not run `away:batch` yet. |
| **2 Approve** | `go build it`, `queue it`, `approved`, `yes build that`, similar explicit approval | Confirm which drafts/items Dan approved. |
| **3 Queue** | After approval only | Add approved items to `PROJECT_STATUS/away-list.json`. Never auto-queue during plan. **High-risk items** (`ship-loop.mdc` tier table) queue only with Dan's explicit pre-approval recorded on the item: `"riskTier": "high-risk", "danApproved": true` (`away:validate` enforces). |
| **4 Execute** | Queue ready (or Dan re-opens with execute starter) | **`npm run away:batch`** — full queued sequence; implement → verify → `away:ship` → `away:validate` per item; halt on fail. |

### Plan phase details

- `away:plan` reuses batch brief data with `mode: "plan"` and plan-only note — no queue writes until approval.
- `queuedItems`: what would run if Dan approves the current queue as-is.
- `suggestedAdditions`: draft template(s) when `batchSize` < `minBatchHint` (3). When queue is stocked (≥3), empty array + `suggestedAdditionsNote: "queue stocked"`.
- **Dan's standing preference: long batch** — suggest enough work at plan time; execute every queued item at execute time.

### Execute phase

For away/sleep/overnight **execute** (phase 4 only):

1. **`npm run away:batch`** — all queued items in `executionProtocol.sequence` order.
2. If **`batchSize` < 3**, note short batch — suggest more at **plan** time next round; do not invent IDs during execute.
3. Read **`PROJECT_STATUS/OVERNIGHT_PROMPT.md`** — starter (B) for execute after approval.
4. Execute items **one at a time**: implement → verify all `verifyBeforeNext` → `npm run away:ship` → `npm run away:validate` → **Ship Verifier** (below) → next item.
5. **Halt on fail** — mark blocked, log `away-status.json`, stop batch and go to REPORT (not the next item). Do not widen to unqueued roadmap work.
6. **Two-tier gate:** if an item turns out mid-build to be **high-risk** (`ship-loop.mdc` tier table) without `danApproved: true`, skip it — mark blocked, report; never improvise or deploy.

Suggest **batch runs** to Dan at plan time; run them only after queue + approval.

## Composer 2.5 = orchestrator (always)

The **parent Composer 2.5 Fast session** is the orchestrator. It:

- Classifies each item (archetype + tier).
- Runs parallel **read-only scouts** when useful (see below).
- **Synthesizes** scout output before any file edit.
- Implements **one away item at a time** — never two items in parallel.
- May delegate **non-overlapping file domains within the current item** to domain executors (`parallel-agent-strategy.mdc` § File-ownership batches); coordinator merges, then runs verify/build/ship itself.
- Runs **verify gates** itself — do not delegate Playwright/build/ship to subagents.
- Declares an item **done** only after verify passes — never on `npm run build` alone for UI work.

Subagents **must not** commit, push, deploy, or mark away items done. The orchestrator owns ship loop + `away-status.json`.

## Parallel agents

**Authoritative:** `.cursor/rules/parallel-agent-strategy.mdc` — scouts parallel by default; **building ≠ max parallel**; away items run **one at a time** (never parallelize ordered away IDs). Pipeline: classify → scouts (if any) → synthesis → executor(s) → verify → ship.

## Verify before “done” (mandatory)

Every away item must pass **all** of its `verifyBeforeNext` commands (exit 0) before the next item starts.

### Always

| Gate | When |
|------|------|
| `npm run build` | Every code/config change |
| Item `verifyBeforeNext` | Every away item — **all** commands, in order |
| `haltOnFailure` | On fail: mark `blocked`, log `away-status.json`, **STOP** batch |

### UI / visible changes (orchestrator “looks good” gate)

Build alone is **not** enough. The orchestrator must prove the change works:

1. **Interactive flows** — run the matching `npm run verify:*` script (clicks + assert end state), e.g. `verify:pickup`, `verify:dispatcher-nav`, `verify:vendor-delivered`.
2. **Visual / layout changes** — before/after Playwright screenshots on every affected route (see `composer-orchestrator.mdc` § UI Verification), or extend an existing verify script with assertions.
3. **After gh-pages deploy** — run `:prod` scripts when they exist (`verify:pickup:prod`, etc.).

Do **not** tell Dan a UI fix is done until local Playwright passes; prod verify after deploy when user-facing.

### Auth for protected routes

```bash
npm run dev
node scripts/playwright-auth-setup.mjs   # if playwright/.auth/state.json missing/expired
```

### Public routes / Firestore writes

- `npm run deploy` ≠ Firestore rules — deploy rules in the **same session** when public writes or rules change.
- CF changes: `firebase deploy --only functions --project stageverify-db` when item requires it.

## Per-item away loop

For each id in `executionProtocol.sequence`:

1. Confirm `dependsOn` predecessor is `status: done`.
2. **Worker `task-start` (hard rule):** Before any file edit or implementation tool call, post `task-start` with `id`, `startedAt` (ISO + timezone), `timingSource: worker_reported`. No implementation until this exists.
3. State scope in one line (what you will / will not add) — **cite matching `svscope_simple.md` §**; do not implement outside scope.
4. Parallel scouts if applicable → synthesis → implement (orchestrator only).
5. Run **all** `verifyBeforeNext` commands.
6. If `escalateWhen` or `escalateBeforeShip`: security-review Task **before push** — see `security-review-gate.mdc`. Await verdict; fix HIGH; completion report must include subagent id + verdict (NOT RUN if gate did not complete).
7. **Worker `task-finish` (hard rule):** Immediately before completion report, post `task-finish` with `finishedAt`, `actualElapsedMin` from timestamp math, `timingSource: worker_reported_timestamps`. Optional `pausedAt`/`resumedAt` when blocking.
8. Set item `status: done` via **`npm run away:ship -- --id <id> --commit <hash> --note "..."`** (updates list, status, CURRENT_STATE, NEXT.md atomically). **Timing audit — `PROJECT_STATUS/estimate-log.md` only** (single source of truth; do not store est/actual in `away-status.json`):
   - **Librarian records** worker `task-start`/`task-finish` into `estimate-log.md` (rolling 15 rows): `startedAt`, `finishedAt`, `budgetMin`, `actualElapsedMin`, `timingSource`, **Type**, **Subtype**, deploy flag, notes — see that file for methodology.
   - **Librarian verifies** `actualElapsedMin` = `round((finishedAt − startedAt) / 60s)`; if worker-stated Actual disagrees, timestamp math wins + timing anomaly in Notes.
   - Missing either timestamp → `actualElapsedMin: unknown`, `timingSource: unknown` — never guess.
   - **`implementationElapsedMin`** (optional in Notes as `impl=N`) is the calibration input when wait/block time is excluded; else use `actualElapsedMin`.
   - **`--note`**: short ship summary only. Optional: `timing: estimate-log row N`; optional `commit=<hash>`.
   - Completion report: **timing table** — `| ID/Task | Budget | Started | Finished | Actual | Timing source | Commit |` (see `estimate-log.md` + `composer-orchestrator.mdc`).
   - **Estimate audit:** when log row count hits **15, 30, 45…**, run **`npm run estimate:audit`** before commit.
   - **Lessons learned:** append one bullet via `npm run lessons:append` or manual edit; `npm run away:validate` catches index drift.
9. Run **`npm run away:validate`** — must pass before commit.
10. Commit, push, deploy UI/CF as required (`ship-loop.mdc`).
11. **Ship Verifier (Grok) — after every substantive push**, same as interactive work (`model-gates.mdc` § Ship Verifier auto-invoke): one read-only Task, `generalPurpose` + `model: "grok-4.5-fast-xhigh"`, path-classified per `model-gates.mdc` § Ship Verifier auto-invoke (SSOT — never by commit prefix). Docs/PROJECT_STATUS-only item → `ship-verifier: N/A (paths excluded)`. **FAIL** → apply fix list, re-verify **once**; still failing or NOT RUN → **halt the batch** (step 5 semantics), record state, go to REPORT.
12. **Item completion report** must include `ship-verifier: <task-id>` (or `N/A (paths excluded)`) and `gotchas: none | recorded — <name>` lines per `composer-orchestrator.mdc` — missing line = NOT RUN.
13. Session cleanup — then next item.

## Escalation

| Trigger | Action |
|---------|--------|
| CF / rules / auth / idempotency (T2+) | security-review Task **before push** — see `security-review-gate.mdc` |
| Same verify fails twice (2nd fail on task) | Sonnet diagnose-only — see `model-gates.mdc` § 2-fail diagnose-only rule |
| Acceptance needs out-of-scope schema/rules | Mark `blocked` — do not widen scope |
| High-risk item without `danApproved: true` | Skip — mark `blocked`, report; never improvise or deploy |
| Item is a phase of a Fable-authored spec | Phase-boundary **work-verifier** (Fable) + **work-verifier conferral** (Grok, AGREE required) before the next phase item starts — spec's own gate note is authoritative (e.g. `docs/location-first-transition-spec.md`); report `work-verifier:` + `work-verifier-confer:` lines (D-24) |

## Current queue

See `away-list.json` → `executionProtocol.sequence`. Copy-paste starters: `PROJECT_STATUS/OVERNIGHT_PROMPT.md` (plan vs execute).

## References

| Topic | File |
|-------|------|
| **Memory router** | `PROJECT_STATUS/MEMORY.md` |
| **Timing audit (SSOT)** | `PROJECT_STATUS/estimate-log.md` |
| **Product authority (wins on conflict)** | `PROJECT_STATUS/svscope_simple.md` |
| Playwright commands | `.cursor/rules/composer-orchestrator.mdc` |
| Parallel scouts | `.cursor/rules/parallel-agent-strategy.mdc` |
| Commit / deploy | `.cursor/rules/ship-loop.mdc` |
| Pickup mistakes | `MODEL_DOSSIER.md` § agent-lessons |
