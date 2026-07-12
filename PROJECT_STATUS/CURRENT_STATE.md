# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 86.75%** — SSOT: `MVP_PATH.md`. E-tag/ESL **frozen for MVP** (D-26); revisit post-MVP with tests.
- Last shipped: **away-125** — Mechanical ESLint cleanup (safe subset); **Phase 4 prod verify** `verify:location-phase4:prod` **15/15 PASS** (`v0.0.33`, gh-pages `2dd401e`) — `openDelivery` deep link PR `cursor/location-phase4-prod-verify-77d5`
- Active Phase: **Location-first Phase 4 complete** → Phase 5 gate (`v0.0.33`): `releasePlannedStagingLocation` CF deployed; vendor release prompt + drawer audit shipped **`5e935fe`** (Sonnet gate PASS `57701217`).
- **Harness (D-18):** Auto-gotcha Phase 0 **shipped** `c2109a8`; pending→indexer-on-ship works; Phase 2 auto-gotcha needs Dan approval.
- **Command interface (Phase 0):** `npm run command:slack` before drive — shipped `ad28000`.
- **Verify:** `verify:location-phase4` **15/15 PASS** local + **prod** — G1 release E2E (NMS G2+GL, release No) + list badges + interactive planned staging.
- Stack: React 19 + TS, Vite 8, Firebase 11.x → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — **post-MVP only (D-26 freeze)** — not blocking MVP done.
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — Dan configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **MVP path (priority):** (1) run `verify:phase14-e2e` local+prod PASS, (2) Dan GCP Gmail deploy — see `MVP_PATH.md`. E-tag frozen (D-26).
- **Post-queue:** see `docs/project_state.md` immediate next steps.
- **Product:** Phase 4 prod verify gate **closed** (`v0.0.33`); Fable work-verifier before location-first Phase 5; push ingest **[high-risk]** — Dan approval.
- **Harness (D-18):** Phase 2 auto-gotcha (`--apply-gotcha`, packet injection) — Dan approval. See `DECISIONS.md` D-18. **Q&A verify loop (D-22)** + **doc drift validate (D-23)** on `main`.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
