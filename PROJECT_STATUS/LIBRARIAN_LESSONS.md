# Librarian lessons learned (SSOT)

> **Canonical rolling log** — mini librarian owns agent lessons. **Feeds (not duplicates):** `gotcha-map.json` (task triggers), `MODEL_DOSSIER.md` § agent-lessons (domain depth), `estimate-log.md` (timing audit only).

## Ship / verify

1. **Deploy + prod verify are one gate.** gh-pages can serve a stale bundle while local verify PASS — always `npm run deploy` then prod scripts after UI ship.
2. **Windows prod verify:** use `cmd /c "set STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify&& npm run verify:…"` — Unix `VAR=… cmd` prefix fails in PowerShell.
3. **Do not say "fixed" without Playwright.** Build alone is insufficient; interactive flows need verify scripts. Detail: dossier § agent-lessons.
- gh-pages branch push ≠ live: npm run deploy must wait for GitHub Pages build status built (legacy build can error after push succeeds).

## Dispatcher UI

4. **Staging action rows:** missing `stagingCode` alone triggers the dark-orange action row — not only pending/readiness (away-089 tighten arc).
5. **Copy Pickup clipboard:** short format omits status/items/qty — customer-facing fields only (job, vendor, PO, link).

## Invoice / parser

6. **Johnstone parser:** backorder-safe fulfillment/status; gate with `test:invoice-parser` and batch fixtures before ship.

## Process / agents

7. **2-fail Sonnet rule:** 1st fail → Composer self-trace; 2nd fail on same task → Sonnet diagnose-only (no edits); Composer implements after findings.
8. **`away:validate` before memory commits** — `CURRENT_STATE.md` requires `Last shipped: **away-NNN**`; narrative after the id is OK.
9. **Gotcha supplements this file** — `npm run context:gotcha -- --task "…"` on task match; read here for rolling lessons, dossier § for domain depth.
- **Lessons index + slice CLI:** type/subtype maps to LIBRARIAN_LESSONS section; away:validate fails on index drift; gotcha prepends matched section.

## Timing (pointer only)

Actual elapsed minutes live in **`PROJECT_STATUS/estimate-log.md`** only (Dan approval → completion report). Do not duplicate timing here.

---

## Jul 3 2026 session

- **Stale gh-pages:** code at b2e60af, prod still on 12044c2 until redeploy — prod verify caught it (lesson #1).
- **Staging rows + short clipboard** shipped same session (lessons #4–5).
- **Dan-to-done timing** + estimate-log subtype taxonomy — timing SSOT in estimate-log only.
- **2-fail Sonnet escalation** rule shipped (replaced 3-fail); lesson #7.

Archive when active body exceeds ~40 lines: `PROJECT_STATUS/archives/librarian-lessons-archive.md`
