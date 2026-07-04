# Away / agent build protocol (stageverify)

> Canonical instructions for running `away-list.json` batches and substantive agent builds in this repo.
> Rules detail: `.cursor/rules/composer-orchestrator.mdc`, `parallel-agent-strategy.mdc`, `ship-loop.mdc`.

## Session start (hot tier — STOP)

1. Read `PROJECT_STATUS/CURRENT_STATE.md` then `PROJECT_STATUS/MEMORY.md` (router + “what’s next” rules).
2. Apply `time-awareness.mdc` (alwaysApply) — binds every reply; see `composer-orchestrator.mdc` session start step 0.

**STOP here** for generic tasks. On demand only:
3. **`npm run away:next`** — canonical next build brief (not roadmap LATER/NEXT alone).
4. **`PROJECT_STATUS/svscope_simple.md`** — product authority; scope disputes only.
5. `PROJECT_STATUS/MODEL_DOSSIER.md` § **agent-lessons** — before UI, pickup, receive, vendor, or public-route work.

## Away / sleep workflow (4 phases — Dan confirmed order)

**Plan → Approve → Queue → Execute.** Plan/approve/queue can run any time of day (`time-awareness.mdc`); execute-batch triggers include sleep/overnight — same protocol, not roadmap.

| Phase | Dan trigger phrases | Agent action |
| ----- | ------------------- | -------------- |
| **1 Plan** | `what should I build while I'm away`, `while I sleep`, `overnight batch`, `run while I'm away`, first away/sleep question | **`npm run away:plan`** — return `queuedItems` + optional `suggestedAdditions` (drafts). **Do not write `away-list.json`.** Do not run `away:batch` yet. |
| **2 Approve** | `go build it`, `queue it`, `approved`, `yes build that`, similar explicit approval | Confirm which drafts/items Dan approved. |
| **3 Queue** | After approval only | Add approved items to `PROJECT_STATUS/away-list.json`. Never auto-queue during plan. |
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
4. Execute items **one at a time**: implement → verify all `verifyBeforeNext` → `npm run away:ship` → `npm run away:validate` → next item.
5. **Halt on fail** — mark blocked, log `away-status.json`, stop batch. Do not widen to unqueued roadmap work.

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

## Parallel agents (default when safe)

Fan out **2–4 read-only scouts in one turn** when work is independent (repo scan, file inventory, read similar components, verify script discovery). **Do not ask Dan** — launch when triggers in `parallel-agent-strategy.mdc` apply.

| OK in parallel | Never in parallel |
|----------------|-------------------|
| Read-only scouts (`explore` Task, `readonly: true`) | Same-file edits |
| Pre-implementation file/pattern search | Firestore rules / schema design |
| Security scan (report only) | Deploy, `firebase deploy`, Playwright on one dev server |
| Independent domain scouts before synthesis | Ordered away items (021 before 022) |

**Pipeline:** classify → parallel scouts (if any) → **synthesis block in reply** → single executor **or** parallel domain executors within the item (coordinator merges) → verify → ship.

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
2. State scope in one line (what you will / will not add) — **cite matching `svscope_simple.md` §**; do not implement outside scope.
3. Parallel scouts if applicable → synthesis → implement (orchestrator only).
4. Run **all** `verifyBeforeNext` commands.
5. If `escalateWhen` or `escalateBeforeShip`: **Sonnet 4.6 security review** before push; fix HIGH before continuing.
6. Set item `status: done` via **`npm run away:ship -- --id <id> --commit <hash> --note "..."`** (updates list, status, CURRENT_STATE, NEXT.md atomically). **Timing audit — `PROJECT_STATUS/estimate-log.md` only** (single source of truth; do not store est/actual in `away-status.json`):
   - Append one row to `estimate-log.md` (rolling 15 rows): `startedAt`, `completedAt`, `budgetMin`, `actualElapsedMin`, **Type**, **Subtype** (taxonomy in that file), deploy flag, notes — see that file for methodology.
   - **Dan approval → done report:** `startedAt` = ISO from Dan's approval message `<timestamp>` (or `unknown`). `completedAt` = ISO when the **parent/coordinator posts the completion report** to Dan (not the feature commit alone). `actualElapsedMin` = nearest whole minute between those — includes build, Playwright, deploy, prod verify, queue wait, and explanation. Parent logs the estimate row when declaring done.
   - **`--note`**: short ship summary only (what shipped, verify results). Optional: `timing: estimate-log row N`; optional `commit=<hash>`. Example: `--note "gotcha map + context:gotcha CLI; verify PASS; timing: estimate-log row 5"`.
   - Completion report: estimate **table** from estimate-log — `| | Budget | Actual | Commit |` when budget exists; `| Actual | Commit |` only when no budget (see `estimate-log.md` + `composer-orchestrator.mdc`).
   - **Estimate audit:** when log row count hits **15, 30, 45…**, run **`npm run estimate:audit`** (add `--apply` if subtype medians recommend budget changes) before commit — see `estimate-log.md` § Audit every 15 rows.
   - **Lessons learned:** append **one bullet** to the matching `LIBRARIAN_LESSONS.md` § for the task **Type/Subtype** — `npm run lessons:append -- --type <type>/<subtype> --bullet "what went wrong or repeat next time"` (updates `librarian-lessons-index.json` line ranges in the same commit). Agent may edit manually if the CLI is awkward; run `npm run away:validate` — index drift fails validate.
7. Run **`npm run away:validate`** — must pass before commit.
8. Commit, push, deploy UI/CF as required (`ship-loop.mdc`).
9. Session cleanup — then next item.

## Escalation

| Trigger | Action |
|---------|--------|
| CF / rules / auth / idempotency (T2+) | Sonnet 4.6 security gate **before push** |
| Same verify fails twice (2nd fail on task) | Sonnet diagnose-only — mandatory (`MODEL_DOSSIER.md` § Composer without Sonnet); 1st fail → self-trace prep |
| Acceptance needs out-of-scope schema/rules | Mark `blocked` — do not widen scope |

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
