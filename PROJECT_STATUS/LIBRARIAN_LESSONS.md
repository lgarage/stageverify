# Librarian lessons learned (SSOT)

> **Compression rule (Dan 2026-07-08):** this file keeps only compressed, reusable rules that change future behavior — never a log of every failure. Distill specifics into general rules; archive the specifics to `archives/librarian-lessons-archive.md`.

> **Canonical rolling log** — mini librarian owns agent lessons. **Feeds (not duplicates):** `gotcha-map.json` (task triggers), `MODEL_DOSSIER.md` § agent-lessons (domain depth), `estimate-log.md` (timing audit only).

## Ship / verify

1. **Verify deployment completed before marking done.** gh-pages branch push ≠ live — always `npm run deploy`, wait for GitHub Pages build status `built`, then prod scripts after UI ship.
2. **Windows prod verify:** use `cmd /c "set STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify&& npm run verify:…"` — Unix `VAR=… cmd` prefix fails in PowerShell.
3. **Do not say "fixed" without Playwright.** Build alone is insufficient; interactive flows need verify scripts. Detail: dossier § agent-lessons. **Prod hideSeedDemoRows:** ORD-001..006 hidden on gh-pages — use `#/dispatcher?openDelivery=<id>` (gotcha `prod-verify-hide-seed-demo`); View timeout ≠ stale bundle. New `verify:*` scripts must use `run-verify-with-learning` **or** self-call `captureVerifyFailure` — bare `node scripts/…` skips pending. Report `gotchas: recorded — prod-verify-hide-seed-demo` when this pattern hits (never `gotchas: none`).

## Dispatcher UI

4. **Staging action rows:** missing `stagingCode` alone triggers the dark-orange action row — not only pending/readiness (away-089 tighten arc).
5. **Copy Pickup clipboard:** short format omits status/items/qty — customer-facing fields only (job, vendor, PO, link).
6. **Dispatcher portal refresh:** Refresh Now on any tab runs `DispatcherPortalProvider.refreshAll()` — Gmail sync + shared cache (invoices, vendors, zones) + `refreshGeneration`; all tabs read same data. Not per-page local fetch only.

## Invoice / parser

7. **Johnstone parser:** backorder-safe fulfillment/status; gate with `test:invoice-parser` and batch fixtures before ship.
8. **Invoice review UX:** Delivery Overview "Needs Review" = offline email fixtures (`emailFixtures.ts` / `getProposedEmailUpdates`), NOT `vendorInvoiceImports`. Johnstone PDF invoices → `/#/invoice-review` only; approve/reject there only. Needs Review has no Approve button by design.
9. **Gmail sync banner:** Sync processed/skipped counts = `inboundEmailProcessing` docs, NOT `vendorInvoiceImports` rows. Banner distinguishes scanned vs queued (`invoicesQueued`, `skippedByStatus`). Empty Invoice Review after sync → check `no_pdf`, parse fail, pending filter, GCP Pub/Sub blocker #4.

## Process / agents

10. **2-fail Sonnet rule:** 1st fail → Composer self-trace; 2nd fail on same task → Sonnet diagnose-only (no edits); Composer implements after findings.
11. **`away:validate` before memory commits** — `CURRENT_STATE.md` requires `Last shipped: **…**`; narrative after the id is OK.
12. **Gotcha supplements this file** — `npm run context:gotcha -- --task "…"` on task match; read here for rolling lessons, dossier § for domain depth.
13. **Lessons index + slice CLI:** type/subtype maps to LIBRARIAN_LESSONS section; away:validate fails on index drift; gotcha prepends matched section.
14. **Security gate on merged commits** — code on main → empty branch diff; use `git diff <commit>^..<commit>` or `git show --stat`; never claim Sonnet PASS without real security-review subagent.
15. **One deploy worker** — after gate: coordinator serially `firebase functions:list` → deploy only if missing → verify; no parallel deploy subagents; interrupt duplicates on request.
16. **Verify ship state before gate/deploy** — confirm `git rev-parse HEAD` vs `origin/main` and `firebase functions:list` for expected CF names; committed ≠ deployed.
17. **Temp secret files** — `.tmp-*secret*` etc.: add to `.gitignore` at creation; delete before session end.
18. **Best reply / handoff prompt** — gather → draft → challenge → revise → present once; **handoffs min 2 internal passes**, best copy-paste block on **first** present (never v1 + "want improvements?"); read away-list + away-status head, verify npm scripts in package.json, self-contained scope + real away-NNN ids + `startedAt` placeholder; execute prompts need "go build it"; backend scope → Sonnet gate before push (`answer-quality.mdc`).
19. **Browser extension console:** "Message channel closed" / "listener indicated asynchronous response" — not StageVerify; Chrome extension noise. Verify incognito without extensions.
20. **Inbound CF writes:** firestoreSafeValue strips undefined before review writes; Refresh Now reprocesses cached-text reparse; reprocess must not overwrite approved/rejected `vendorInvoiceImports` rows; Sonnet security-review Task before CF push.
21. **Security gate evidence standard** — report block: `security-gate-id`, reviewer/subagent, claimed model, `actual model invocation evidence: yes/no/unknown`, evidence path, verdict, limitations, `production decision affected`. Do NOT write Sonnet PASS or Fable verdict without invocation evidence; Fable 5 requires explicit Task — Fable-style ≠ Fable 5. Full spec: `PROJECT_STATUS/archives/SECURITY_GATE_AUDIT_2026-07-07.md`.

## Vendor email / reply ingest

22. **Controlled pilot only:** reply ingest is not broad production — verify `emailReplyIngestEnabled` + `emailReplyIngestSince` on `appSettings/config` and report both before any ingest work; do NOT flip flag without Dan explicit go/rollback.
23. **Push ingest broken:** `gmailInboxPushIngest` logs `unparseable push payload — skipping` — use Refresh Now / `syncInboundGmail` / `triggerInboundGmailSyncCallable` for controlled tests.
24. **Thread hygiene:** do NOT reuse bounce-polluted threads (test5/bounce); run wrong-thread negative tests before real vendor use; old `no_pdf` docs are NOT reprocessed — fresh replies must be after `emailReplyIngestSince`.
25. **Needs Review tier:** matched vendor replies → "Vendor Reply — Needs Review" (calm copy v0.0.23); Suspicious only for unmatched/ambiguous/spoof. Reply ingest must NOT mutate delivery status or create delivery shells.

## Timing (pointer only)

Actual elapsed minutes live in **`PROJECT_STATUS/estimate-log.md`** only (Dan approval → completion report). Do not duplicate timing here.

Archive when active body exceeds ~40 lines: `PROJECT_STATUS/archives/librarian-lessons-archive.md`
