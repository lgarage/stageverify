# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired — Firebase Firestore live + Cloud Functions active
- Last shipped: `ReceivingPage` at `/receive` (mobile scan QR ? check-in items ? assign zone ? submit); `MobileHubPage` at `/hub` (protected splash with 3 workflow buttons: vendor check-in, tech checkout, supplies receive); `?next=` login redirect support. Commits: c049b76, 1e68adf, 3d97fb1.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. All legacy mock files deleted - canonical models in src/dispatcher/models.ts only.

## Active Blocker
None.

## Immediate Next Step
1. **Firebase Auth** — protect `/dispatcher` + `/settings` routes with login screen (no auth exists today).
2. **Staging Zone Management page** — sidebar "Staging Map" is a dead link; need page to create/edit zones + print QR labels.
3. **Check-in consolidation + qtyDamaged** — `App.tsx` and `CheckInPage.tsx` are two parallel impls; `qtyDamaged` hardcoded to 0 in App.tsx scanner flow.
4. **Hub as default mobile entry** — consider redirecting `/` to `/hub` for logged-in users (currently hub is only reachable via `/#/hub` direct nav or `?next=/hub` on login).

## Last Session (2026-06-01)
- feat: `ReceivingPage` at `/#/receive` — mobile-first 4-step flow: QR scan tag on delivered package ? item check-in steppers with auto-save ? staging zone picker ? submit. Reuses all existing firestoreService write paths. (c049b76, 1e68adf)
- feat: `MobileHubPage` at `/#/hub` (protected) — splash page with 3 large buttons for vendor check-in, tech parts checkout, manual supplies check-in. (3d97fb1)
- feat: `?next=` query param on LoginPage — `/#/login?next=/hub` lands on hub post-login. Open-redirect guard included.
- trial: backend-write-critical Trial #1+#2 — Composer 2.5 built both features; Opus graded both **clean**. Composer 2.5 now at 2/5 consecutive clean passes.
- lesson: use `npm run build` over `tsc --noEmit` in builder prompts — Vite catches TS strict-overlap cast errors that noEmit misses.

## Prev Session (2026-06-01, earlier)
- feat: added `ready_for_pickup` status — replaces `complete` in active delivery flow; all transitions, write paths, labels, and Cloud Functions updated. Backward compat kept for existing `complete` records (a0f0f9f).
- fix: EntryDisplayPage replaceAll so `ready_for_pickup` ? "READY FOR PICKUP"; CheckInPage gate blocks re-check-in on both `complete` and `ready_for_pickup` (66d1909).
- feat: pickup portal `PICKUP_READY` filter now includes `ready_for_pickup` — orders visible in pickup app after new status flow.
- feat: fuzzy zone code matching — `normalizeZoneCode` strips dashes/spaces and uppercases; `s2a` now resolves to `S2-A` in walk-up.

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold - read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
