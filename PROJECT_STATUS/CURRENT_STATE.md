# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: MVP complete → full delivery lifecycle live (Ordered→Shipped→Received→Staged→Picked Up→Installed)
- Last shipped: public pickup batch write + Firestore rules deployed (shipped/installed statuses).
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2, qrcode.react. Deploy: GitHub Pages — https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes + entrywayEslTagId. Canonical models in src/dispatcher/models.ts.

## Active Blockers
1. **Minew ESL creds (external — live ESL demo only)** — waiting on vendor login for demo kit; live ESL integration unavailable until creds arrive. Does **not** block Phase 2 or general development. See ESL_INTEGRATION_PLAN.md.
2. **Shelving decision** — waiting on Jake Korb. Blocks: shop map, location ID assignment, tag count, tag order.
3. **Physical shop map** — not yet created. Blocks full location ID assignment and Minew tag deployment.
See PROJECT_STATUS/PHYSICAL_DEPLOYMENT.md for full dependency chain.

## Immediate Next Step
1. **Phase 2:** Material Readiness Data Model (active development track) — see `docs/roadmap.md` NOW section.
2. **ESL Cloud Function** (Phase 7; backend-write-critical) — resume when MinewTag API creds arrive. Live ESL feature remains unavailable until then; does not block Phase 2.

## Canonical references
- Phase: `docs/project_state.md` | Roadmap: `docs/roadmap.md` | Warm: `MODEL_DOSSIER.md` | Away: `away-list.json` | AECS: `docs/aecs/phase-2-plan.md` | History: `archives/session-log-2026-06.md`

## Update Protocol
- After **meaningful work** (not routine code-only edits): evaluate memory impact — full process in `docs/roadmap.md` § Memory maintenance.
- Hot tier **here only:** Snapshot, Blockers, Immediate Next Step. Cap ~30 lines; overflow → `PROJECT_STATUS/archives/`.
- Phase/feature ships: update `docs/project_state.md` + `docs/roadmap.md` in same commit; sync this snapshot.
- Before handoff: report docs touched (or why none); cross-doc consistency check before commit.
