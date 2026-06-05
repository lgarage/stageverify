# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> Overflow → migrate into PROJECT_STATUS/archives/. Read protocol: agent-ops skill §1.

## Snapshot
- Active Phase: MVP complete → full delivery lifecycle live (Ordered→Shipped→Received→Staged→Picked Up→Installed)
- Last shipped: public pickup batch write + Firestore rules deployed (shipped/installed statuses).
- Stack: React 19 + TS (strict, ES2023), Vite 8, React Router 7, Tailwind 4, html5-qrcode 2.3.8, firebase 11.x, firebase-functions v2, qrcode.react. Deploy: GitHub Pages — https://lgarage.github.io/stageverify
- Data: Firebase Firestore (project: stageverify-db, Blaze plan). appSettings/config holds vendorRevertWindowMinutes + autoSubmitMinutes + entrywayEslTagId. Canonical models in src/dispatcher/models.ts.

## Active Blockers
1. **Minew ESL creds** — waiting on vendor login for demo kit (ESL Cloud Function blocked). See ESL_INTEGRATION_PLAN.md.
2. **Shelving decision** — waiting on Jake Korb. Blocks: shop map, location ID assignment, tag count, tag order.
3. **Physical shop map** — not yet created. Blocks full location ID assignment and Minew tag deployment.
See PROJECT_STATUS/PHYSICAL_DEPLOYMENT.md for full dependency chain.

## Immediate Next Step
1. **ESL Cloud Function** (backend-write-critical) — BLOCKED on MinewTag API creds (waiting on vendor login for demo kit).
2. **Phase 2:** Material Readiness Data Model — see `docs/roadmap.md` NOW section.

## Canonical references
- **Phase truth:** `docs/project_state.md` (features, deployment, known issues, V2 vision)
- **Roadmap:** `docs/roadmap.md` (NOW/NEXT/LATER phases)
- **Warm tier:** `PROJECT_STATUS/MODEL_DOSSIER.md` (QR, nav, backend-critical lessons)
- **Away queue:** `PROJECT_STATUS/away-list.json`
- Session history: `PROJECT_STATUS/archives/session-log-2026-06.md`

## Update Protocol
- Touch Snapshot / Active Blockers / Immediate Next Step at end of every session.
- When a phase gate or feature ships, update **docs/project_state.md** and **docs/roadmap.md** in the same commit — keep this file to hot-tier snapshot only.
- Hard size cap: ~30 lines. Archive session entries to `PROJECT_STATUS/archives/`.
