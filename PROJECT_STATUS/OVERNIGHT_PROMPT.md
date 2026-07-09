# Away / overnight batch prompt (copy into new conversation)

**Away = sleep = overnight** — same batch protocol. Full protocol: **`PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`**.

**4-phase workflow:** Plan → Approve → Queue → Execute. Use the right starter below.

**Dan's standing preference: long batch** (≥3 queued items). At **plan** time, `away:plan` shows `queuedItems` + draft `suggestedAdditions` when short. At **execute** time, run **every** queued item — not just the head.

---

**Batch 3 (away-021…041) is closed.** Archived in `PROJECT_STATUS/archives/away-batch-3.json`.

Active queue: `PROJECT_STATUS/away-list.json` (away-042…046 when stocked).

**Orchestrator:** Composer 2.5 Fast — parallel read-only scouts when useful; **you** run verify + ship.

**Prerequisites (execute phase):** `.env.local` test creds; `node scripts/playwright-auth-setup.mjs` if auth expired.

---

## (A) Plan-only starter — first away/sleep question

Use when Dan asks what to build while away/sleep/overnight **without** having said "go build it" yet.

```
Read PROJECT_STATUS/MEMORY.md and CURRENT_STATE.md first.
Run npm run away:plan (NOT away:batch yet).
Protocol: PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md — Plan → Approve → Queue → Execute.
Product authority: PROJECT_STATUS/svscope_simple.md
Summarize queuedItems and suggestedAdditions. Do NOT write away-list.json until I approve with "go build it".
```

---

## (B) Execute starter — after Dan approved and queue is ready

Use when Dan said **go build it** (queue updated) or explicitly wants execution now.

```
Read PROJECT_STATUS/MEMORY.md and CURRENT_STATE.md first.
Run npm run away:batch and execute every returned item in order (away = sleep = overnight).
Protocol: PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md
Product authority: PROJECT_STATUS/svscope_simple.md
After each item: npm run away:ship then npm run away:validate, then Ship Verifier (Grok) per
model-gates.mdc when paths qualify; report ship-verifier: and gotchas: lines per item.
Halt on fail (verify OR Ship Verifier FAIL/NOT RUN after one re-verify) — go to report, not next item.
High-risk items (ship-loop tier table) run only if danApproved: true; else skip + mark blocked.
Do not widen scope. Do not redo archived away-001…041.
```
