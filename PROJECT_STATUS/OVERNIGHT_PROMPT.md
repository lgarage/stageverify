# Overnight / away-batch prompt (copy into new conversation)

Paste as your **first message** in a new Cursor chat (Agent mode). Full protocol: **`PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`**.

---

Run **`away-021` through `away-041`** in order from `PROJECT_STATUS/away-list.json`.

**Orchestrator:** Composer 2.5 Fast (parent session) — parallel read-only scouts when useful; **you** run verify + ship; subagents do not commit or declare done.

**Verify:** Every item — all `verifyBeforeNext` exit 0; UI changes need Playwright (not build alone); prod `:prod` scripts after deploy. Read `AWAY_BUILD_PROTOCOL.md` § Verify before “done”.

**Protocol:** `executionProtocol` in away-list — halt on fail; Sonnet 4.6 before push when `escalateWhen` / `escalateBeforeShip`; log `away-status.json`.

Read first: `CURRENT_STATE.md`, `MODEL_DOSSIER.md` § agent-lessons.

**Prerequisites:** `.env.local` → `STAGEVERIFY_TEST_EMAIL` / `STAGEVERIFY_TEST_PASSWORD`; `node scripts/playwright-auth-setup.mjs` if auth expired.

**Start at:** `away-021` (`away-015`…`020` already done).

---

## Batch 3 summary (svscope-aligned)

| IDs | Focus |
|-----|--------|
| 021–024 | Slice 4 — vendor session, enforce, TTL, geofence |
| 025–028 | Slice 5 — pickup tokens, validate, copy link, leave-shop reminder |
| 029–032 | §10 — job header, group by location, PO rows, persist checklist |
| 033–035 | §11 — Staged label, Running Low, shop stock groups |
| 036–037 | Slice 6 — combination staging stub + CF release |
| 038 | §13 — dispatcher pickup summary |
| 039–040 | Phase 4 — resolve issues + readiness recalc |
| 041 | Deploy + prod verify + roadmap sync |
