# Away / agent build protocol (stageverify)

> Canonical instructions for running `away-list.json` batches and substantive agent builds in this repo.
> Rules detail: `.cursor/rules/composer-orchestrator.mdc`, `parallel-agent-strategy.mdc`, `ship-loop.mdc`.

## Session start (mandatory)

1. Read `PROJECT_STATUS/CURRENT_STATE.md` (blockers + active queue).
2. Read **`PROJECT_STATUS/svscope_simple.md`** — product authority; every feature and away item must align with scope §; scope wins on conflict.
3. Read `PROJECT_STATUS/MODEL_DOSSIER.md` § **agent-lessons** before UI, pickup, receive, vendor, or public-route work.
4. Open `PROJECT_STATUS/away-list.json` — follow `executionProtocol.sequence` in order.

## Composer 2.5 = orchestrator (always)

The **parent Composer 2.5 Fast session** is the orchestrator. It:

- Classifies each item (archetype + tier).
- Runs parallel **read-only scouts** when useful (see below).
- **Synthesizes** scout output before any file edit.
- Implements **one item at a time** (single executor — no parallel writers).
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

**Pipeline:** classify → parallel scouts (if any) → **synthesis block in reply** → one executor edit → verify → ship.

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
6. Set item `status: done` in `away-list.json`.
7. Append `{id, status: built|blocked, commit, note}` to `away-status.json`.
8. Commit, push, deploy UI/CF as required (`ship-loop.mdc`).
9. Session cleanup (stop dev servers, delete verify PNGs, clean git) — then next item.

## Escalation

| Trigger | Action |
|---------|--------|
| CF / rules / auth / idempotency (T2+) | Sonnet 4.6 security gate **before push** |
| Same verify fails twice after one fix | Sonnet or self-trace (`MODEL_DOSSIER.md` § Composer without Sonnet) |
| Acceptance needs out-of-scope schema/rules | Mark `blocked` — do not widen scope |

## Current queue

See `away-list.json` → `executionProtocol.sequence`. Copy-paste starter: `PROJECT_STATUS/OVERNIGHT_PROMPT.md`.

## References

| Topic | File |
|-------|------|
| **Product authority (wins on conflict)** | `PROJECT_STATUS/svscope_simple.md` |
| Playwright commands | `.cursor/rules/composer-orchestrator.mdc` |
| Parallel scouts | `.cursor/rules/parallel-agent-strategy.mdc` |
| Commit / deploy | `.cursor/rules/ship-loop.mdc` |
| Pickup mistakes | `MODEL_DOSSIER.md` § agent-lessons |
