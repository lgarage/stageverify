# Overnight / away-batch prompt (copy into new conversation)

Paste as your **first message** in a new Cursor chat (Agent mode). Full protocol: **`PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`**.

---

Continue the away batch from **`away-031` through `away-041`** in order from `PROJECT_STATUS/away-list.json`.

**Orchestrator:** Composer 2.5 Fast (parent session) — parallel read-only scouts when useful; **you** run verify + ship; subagents do not commit or declare done.

**Verify:** Every item — all `verifyBeforeNext` exit 0; UI changes need Playwright (not build alone); prod `:prod` scripts after deploy (`away-041`). Read `AWAY_BUILD_PROTOCOL.md` § Verify before “done”.

**Protocol:** `executionProtocol` in away-list — halt on fail; Sonnet 4.6 before push when `escalateWhen` / `escalateBeforeShip`; log `away-status.json`; ship loop (commit, push, deploy) per item.

Read first:
- `PROJECT_STATUS/CURRENT_STATE.md`
- `PROJECT_STATUS/away-list.json` + `away-status.json`
- `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`
- `MODEL_DOSSIER.md` § agent-lessons (pickup / public routes)

**Prerequisites:** `.env.local` → `STAGEVERIFY_TEST_EMAIL` / `STAGEVERIFY_TEST_PASSWORD`; `node scripts/playwright-auth-setup.mjs` if auth expired.

**Already done (do not redo):** `away-021`…`030` shipped. **`away-028` geofence deferred** per Dan — skip re-implementing leave-shop GPS reminder.

**Start at:** `away-031` (PO line labels on pickup item rows).

**Run as much as possible** — one item at a time through verify + ship; stop batch only on verify fail twice or Sonnet HIGH risk.

---

## Remaining queue (031–041)

| IDs | Focus |
|-----|--------|
| 031 | §10 — PO prefix on pickup item rows |
| 032 | §10 — persist technician item checklist (T2, rules/CF, Sonnet gate) |
| 033–035 | §11 — Staged label, Running Low, shop stock location groups |
| 036–037 | Slice 6 — combination staging stub + CF release (037 may block on shop map) |
| 038 | §13 — dispatcher pickup summary |
| 039–040 | Phase 4 — resolve issues + readiness recalc |
| 041 | Batch close — deploy + prod verify + roadmap sync |

---

## Copy-paste starter (first message in new chat)

```
Continue the away batch from away-031 (away-021…030 already shipped).
Read first:
- PROJECT_STATUS/CURRENT_STATE.md
- PROJECT_STATUS/away-list.json + away-status.json
- PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md
Done (do not redo): away-021…030 — vendor session, pickup tokens, job header, staging sections; away-028 geofence deferred.
Start at: away-031 (PO line labels on pickup rows).
Run away-031 through away-041 in order — as much as possible while I'm away. Halt only on verify fail or Sonnet HIGH. Verify gates + ship loop per protocol.
```
