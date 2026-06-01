# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> Overflow ? migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill S1.

## Snapshot
- Active Phase: Backend wired ? Firebase Firestore live + Cloud Functions active
- Last shipped: `firestore.rules` + `firebase.json` updated ? Firestore security rules written (Composer 2.5, Trial #3, Opus grade: clean). Committed to repo but NOT YET deployed to Firebase (see Active Blocker). Composer 2.5 now at 3/5 consecutive clean passes.
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2. Deploy: GitHub Pages - https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes. All legacy mock files deleted - canonical models in src/dispatcher/models.ts only.

## Active Blocker
`firestore.rules` committed but NOT deployed: `getDeliveryDetails()` in `firestoreService.ts` reads from auth-gated collections (`jobs`, `purchaseOrders`, `statusHistory`, `pickupEvents`). Called from 4 unauthenticated routes (`/`, `/pickup`, `/checkin/:orderId`, `/receive`). Deploying rules now will break those mobile flows. Fix: split `getDeliveryDetails` into auth/unauth variants (strip `jobs`/`purchaseOrders`/`statusHistory`/`pickupEvents` reads from unauth path). Then run `firebase deploy --only firestore:rules`.

## Immediate Next Step
1. **Fix getDeliveryDetails for unauthenticated callers** (multi-file-feature, Composer 2.5) ? split into auth/unauth variants, then deploy rules with `firebase deploy --only firestore:rules`.
2. **Firebase Auth** - protect `/dispatcher` + `/settings` routes with login screen (no auth exists today).
3. **Staging Zone Management page** - sidebar "Staging Map" is a dead link; need page to create/edit zones + print QR labels.
4. **Check-in consolidation + qtyDamaged** - `App.tsx` and `CheckInPage.tsx` are two parallel impls; `qtyDamaged` hardcoded to 0 in App.tsx scanner flow.

## Last Session (2026-06-01)
- feat: redirect `/` to `/hub` for authenticated users. (b315f60)
- feat: `firestore.rules` ? Composer 2.5 Trial #3, Opus graded clean (8/8 criteria). Firestore security rules with field-restricted unauth writes, enum enforcement, append-only audit logs. Committed; deploy blocked pending getDeliveryDetails fix.
- feat: `ReceivingPage` at `/#/receive` ? mobile-first 4-step flow: QR scan ? check-in steppers ? zone picker ? submit. (c049b76, 1e68adf)
- feat: `MobileHubPage` at `/#/hub` + `?next=` redirect support. (3d97fb1)
- trial: Composer 2.5 now 3/5 consecutive clean passes (3/10 trials used).

## Prev Session (2026-06-01, earlier)
- feat: added `ready_for_pickup` status; pickup portal filter updated. (a0f0f9f, 66d1909)
- feat: fuzzy zone code matching ? `normalizeZoneCode` strips dashes/spaces.

## Agent-ops reference
- Away-list tasks: PROJECT_STATUS/away-list.json (run status: away-status.json)
- Phase 2 explanation: PROJECT_STATUS/AGENT_OPS_PHASE2.md (cold - read only when asked)
- Brain repo / learning status: C:\Projects\cursor-agent-brain\STATS.md

## Update Protocol
- Touch Snapshot / Active Blocker / Immediate Next Step at end of every session.
- "Immediate Next Step" describes what the NEXT session should do.
- Hard size cap: if total lines = 55, collapse oldest snapshot entries into archives/.
