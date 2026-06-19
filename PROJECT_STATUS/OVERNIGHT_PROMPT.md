# Away / overnight batch prompt (copy into new conversation)

**Away = sleep = overnight** — same batch protocol. Paste as your **first message** in a new Cursor chat (Agent mode). Full protocol: **`PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`**.

**Dan's standing preference: long batch** — execute **every** queued item, not just the head. If `away:batch` reports `batchSize` < 3, note short batch and suggest queuing more in `away-list.json` (do not invent IDs).

---

**Batch 3 (away-021…041) is closed.** Archived in `PROJECT_STATUS/archives/away-batch-3.json`.

Run the **active queue** from `PROJECT_STATUS/away-list.json`:

1. `npm run away:batch` — full queued sequence (not roadmap); expect `longBatchExpected: true`  
2. Read `PROJECT_STATUS/MEMORY.md` (router) + `PROJECT_STATUS/svscope_simple.md`  
3. For each item in order: implement → verify all `verifyBeforeNext` → `npm run away:ship -- --id <id> --note "..."`  
4. `npm run away:validate` before declaring done — halt batch on fail  

**Orchestrator:** Composer 2.5 Fast — parallel read-only scouts when useful; **you** run verify + ship.

**Prerequisites:** `.env.local` test creds; `node scripts/playwright-auth-setup.mjs` if auth expired.

---

## Copy-paste starter

```
Read PROJECT_STATUS/MEMORY.md and CURRENT_STATE.md first.
Run npm run away:batch and execute every returned item in order (away = sleep = overnight).
Protocol: PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md
Product authority: PROJECT_STATUS/svscope_simple.md
After each item: npm run away:ship then npm run away:validate; halt on fail.
Do not widen scope. Do not redo archived away-001…041.
```
