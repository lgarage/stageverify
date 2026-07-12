# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Last shipped: **away-125** — Mechanical ESLint cleanup (safe subset); **Phase 4 prod verify** `verify:location-phase4:prod` **15/15 PASS** (`v0.0.33`, gh-pages `2dd401e`) — `openDelivery` deep link PR `cursor/location-phase4-prod-verify-77d5`
- Active Phase: **Location-first Phase 4 complete** → Phase 5 gate (`v0.0.33`): `releasePlannedStagingLocation` CF deployed; vendor release prompt + drawer audit shipped **`5e935fe`** (Sonnet gate PASS `57701217`).
- **Harness (D-18):** Auto-gotcha Phase 0 **shipped** `c2109a8`; pending→indexer-on-ship works; Phase 2 auto-gotcha needs Dan approval.
- **Command interface (Phase 0):** `npm run command:slack` before drive — shipped `ad28000`.
- **Verify:** `verify:location-phase4` **15/15 PASS** local + **prod** — G1 release E2E (NMS G2+GL, release No) + list badges + interactive planned staging.
- Stack: React 19 + TS, Vite 8, Firebase 11.x → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — Dan configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **away-126** — Fable work-verifier + Grok conferral (D-24) on Phase 4→5 boundary (offline; `npm run away:next`). ESL/shop map do not block unless scope says otherwise.
- **Product:** Phase 4 prod verify gate **closed** (`v0.0.33`); location-first Phase 5 blocked until away-126 AGREE PASS; push ingest **[high-risk]** — Dan approval.
- **Harness:** Phase 2 auto-gotcha (D-18) — Dan approval. **Fable conferral loop universal (D-24)** on this branch.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
