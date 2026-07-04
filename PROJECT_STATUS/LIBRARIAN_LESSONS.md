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
17. **Dispatcher portal refresh:** Refresh Now on any tab runs `DispatcherPortalProvider.refreshAll()` — Gmail sync + shared cache (invoices, vendors, zones) + `refreshGeneration`; all tabs read same data. Not per-page local fetch only.

## Invoice / parser

6. **Johnstone parser:** backorder-safe fulfillment/status; gate with `test:invoice-parser` and batch fixtures before ship.
15. **Invoice review UX:** Delivery Overview "Needs Review" = offline email fixtures (`emailFixtures.ts` / `getProposedEmailUpdates`), NOT `vendorInvoiceImports`. Johnstone PDF invoices → `/#/invoice-review` only; approve/reject there only. Needs Review has no Approve button by design.
16. **Gmail sync banner:** Sync processed/skipped counts = `inboundEmailProcessing` docs, NOT `vendorInvoiceImports` rows. Banner distinguishes scanned vs queued (`invoicesQueued`, `skippedByStatus`). Empty Invoice Review after sync → check `no_pdf`, parse fail, pending filter, GCP Pub/Sub blocker #4.
19. **Johnstone S/O 4046362 / U+XX00:** tabular header parsing; pdf-parse custom-font encoding; issue-import when Invoice # missing; Approve blocked server+UI.

## Process / agents

7. **2-fail Sonnet rule:** 1st fail → Composer self-trace; 2nd fail on same task → Sonnet diagnose-only (no edits); Composer implements after findings.
8. **`away:validate` before memory commits** — `CURRENT_STATE.md` requires `Last shipped: **away-NNN**`; narrative after the id is OK.
9. **Gotcha supplements this file** — `npm run context:gotcha -- --task "…"` on task match; read here for rolling lessons, dossier § for domain depth.
- **Lessons index + slice CLI:** type/subtype maps to LIBRARIAN_LESSONS section; away:validate fails on index drift; gotcha prepends matched section.
10. **Security gate on merged commits** — code on main → empty branch diff; use `git diff <commit>^..<commit>` or `git show --stat`; never claim Sonnet PASS without real security-review subagent.
11. **One deploy worker** — after gate: coordinator serially `firebase functions:list` → deploy only if missing → verify; no parallel deploy subagents; interrupt duplicates on request.
12. **Verify ship state before gate/deploy** — confirm `git rev-parse HEAD` vs `origin/main` and `firebase functions:list` for expected CF names; committed ≠ deployed.
13. **Temp secret files** — `.tmp-*secret*` etc.: add to `.gitignore` at creation; delete before session end.
14. **Best reply / handoff prompt** — gather → draft → challenge → revise → present once; **handoffs min 2 internal passes**, best copy-paste block on **first** present (never v1 + "want improvements?"); read away-list + away-status head, verify npm scripts in package.json, self-contained scope + real away-NNN ids + `startedAt` placeholder; execute prompts need "go build it"; backend scope → Sonnet gate before push (`best-reply-gate.mdc`).
18. **Browser extension console:** "Message channel closed" / "listener indicated asynchronous response" — not StageVerify; Chrome extension noise. Verify incognito without extensions.
20. **Inbound CF writes:** firestoreSafeValue strips undefined before review writes; Refresh Now reprocesses cached-text reparse; reprocess must not overwrite approved/rejected `vendorInvoiceImports` rows; Sonnet security-review Task before CF push.

## Timing (pointer only)

Actual elapsed minutes live in **`PROJECT_STATUS/estimate-log.md`** only (Dan approval → completion report). Do not duplicate timing here.

---

## Jul 3 2026 session

- **Stale gh-pages:** code at b2e60af, prod still on 12044c2 until redeploy — prod verify caught it (lesson #1).
- **Staging rows + short clipboard** shipped same session (lessons #4–5).
- **Dan-to-done timing** + estimate-log subtype taxonomy — timing SSOT in estimate-log only.
- **2-fail Sonnet escalation** rule shipped (replaced 3-fail); lesson #7.

## Jul 4 2026 session

- **Invoice review vs Needs Review:** agents confused offline email fixtures with `vendorInvoiceImports` — lessons #15–16.
- **Gmail sync banner vs invoice queue:** processed/skipped counts from `inboundEmailProcessing`, not import rows — lesson #16.
- **Dispatcher Refresh Now:** shared `refreshAll()` across tabs, not per-page fetch — lesson #17.
- **Chrome extension console noise:** not SV bugs — lesson #18.

Archive when active body exceeds ~40 lines: `PROJECT_STATUS/archives/librarian-lessons-archive.md`
