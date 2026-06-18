# Overnight / away-batch prompt (copy into new conversation)

Paste as your **first message** in a new Cursor chat (Agent mode). Full protocol: **`PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`**.

---

Continue the away batch from **`away-034` through `away-041`** in order from `PROJECT_STATUS/away-list.json`.

**Orchestrator:** Composer 2.5 Fast (parent session) — parallel read-only scouts when useful; **you** run verify + ship; subagents do not commit or declare done.

**Verify:** Every item — all `verifyBeforeNext` exit 0; UI changes need Playwright (not build alone); prod `:prod` scripts after deploy (`away-041`). Read `AWAY_BUILD_PROTOCOL.md` § Verify before “done”.

**Protocol:** `executionProtocol` in away-list — halt on fail; Sonnet 4.6 before push when `escalateWhen` / `escalateBeforeShip`; log `away-status.json`; ship loop (commit, push, deploy) per item.

Read first:
- `PROJECT_STATUS/CURRENT_STATE.md`
- **`PROJECT_STATUS/svscope_simple.md`** — product authority; align every item to scope §; scope wins on conflict
- `PROJECT_STATUS/away-list.json` + `away-status.json`
- `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`
- `MODEL_DOSSIER.md` § agent-lessons (pickup / public routes)

**Prerequisites:** `.env.local` → `STAGEVERIFY_TEST_EMAIL` / `STAGEVERIFY_TEST_PASSWORD`; `node scripts/playwright-auth-setup.mjs` if auth expired.

**Already done (do not redo):** `away-021`…`033` shipped. **`away-028` geofence deferred** per Dan — skip re-implementing leave-shop GPS reminder.

**Start at:** `away-034` (Running Low on shop stock lines).

**Run as much as possible** — one item at a time through verify + ship; stop batch only on verify fail twice or Sonnet HIGH risk.

---

## Remaining queue (034–041)

| IDs | Focus |
|-----|--------|
| 034–035 | §11 — Running Low, shop stock location groups |
| 036–037 | Slice 6 — combination staging stub + CF release (037 may block on shop map) |
| 038 | §13 — dispatcher pickup summary |
| 039–040 | Phase 4 — resolve issues + readiness recalc |
| 041 | Batch close — deploy + prod verify + roadmap sync |

---

## Copy-paste starter (first message in new chat)

```
Continue the away batch from away-034 (away-021…033 already shipped).
Read first:
- PROJECT_STATUS/CURRENT_STATE.md
- PROJECT_STATUS/svscope_simple.md (product authority — align all work to scope §)
- PROJECT_STATUS/away-list.json + away-status.json
- PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md
Done (do not redo): away-021…033 — vendor session, pickup tokens, job header, staging sections, PO labels, checklist persist, Staged label; away-028 geofence deferred.
Start at: away-034 (Running Low on shop stock lines).
Run away-034 through away-041 in order — as much as possible while I'm away. Halt only on verify fail or Sonnet HIGH. Verify gates + ship loop per protocol. Do not widen scope beyond svscope_simple.md.
```
