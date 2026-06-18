# Overnight / away-batch prompt (copy into new conversation)

Paste as your **first message** in a new Cursor chat (Agent mode). Full protocol: **`PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`**.

---

**Batch 3 (away-021…041) is closed.** Archived in `PROJECT_STATUS/archives/away-batch-3.json`.

Run the **active queue** from `PROJECT_STATUS/away-list.json`:

1. `npm run away:next` — first queued item with dependsOn satisfied  
2. Read `PROJECT_STATUS/MEMORY.md` (router) + `PROJECT_STATUS/svscope_simple.md`  
3. Implement → verify all `verifyBeforeNext` → `npm run away:ship -- --id <id> --note "..."`  
4. `npm run away:validate` before declaring done  

**Orchestrator:** Composer 2.5 Fast — parallel read-only scouts when useful; **you** run verify + ship.

**Prerequisites:** `.env.local` test creds; `node scripts/playwright-auth-setup.mjs` if auth expired.

---

## Copy-paste starter

```
Read PROJECT_STATUS/MEMORY.md and CURRENT_STATE.md first.
Run npm run away:next and execute the returned item only.
Protocol: PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md
Product authority: PROJECT_STATUS/svscope_simple.md
After verify: npm run away:ship then npm run away:validate
Do not widen scope. Do not redo archived away-001…041.
```
