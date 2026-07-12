# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **MVP: 88.59%** — SSOT: `MVP_PATH.md`. E-tags/ESL **not in MVP scope** (D-26). §14 E2E **local + prod PASS** (`verify:phase14-e2e:prod` 2026-07-12).
- Last shipped: **§14 E2E prod gate** — reset-pickup deep-link for `hideSeedDemoRows` + Windows `shell:true` spawn; main post-PR#18 `@763e630`+.
- Active Phase: **Location-first Phase 4 complete** → Phase 5 gate (`v0.0.33`): `releasePlannedStagingLocation` CF deployed; vendor release prompt + drawer audit shipped **`5e935fe`** (Sonnet gate PASS `57701217`).
- **Harness (D-18):** Auto-gotcha Phase 0 **shipped** `c2109a8`; pending→indexer-on-ship works; Phase 2 auto-gotcha needs Dan approval.
- **Command interface (Phase 0):** `npm run command:slack` before drive — shipped `ad28000`.
- **Verify:** `verify:location-phase4` **15/15 PASS** local + **prod** — G1 release E2E (NMS G2+GL, release No) + list badges + interactive planned staging.
- Stack: React 19 + TS, Vite 8, Firebase 11.x → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Shelving decision (Jake Korb)** — shop map / location IDs.
2. **Physical shop map** — not created (blocks sign printing only).
3. **Inbound Gmail CF + rules deploy** — Dan configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM (do not claim email MVP % until live ingest proven).

## Immediate Next Step
- **MVP path (priority):** (1) Dan GCP Gmail prep on PC — **no CF deploy until Dan approves** — see `MVP_PATH.md`; (2) core regression prod re-verify after next MVP-touching ship.
- **Post-queue:** see `docs/project_state.md` immediate next steps.
- **Product:** Phase 4 prod verify gate **closed** (`v0.0.33`); Fable work-verifier before location-first Phase 5; push ingest **[high-risk]** — Dan approval.
- **Harness (D-18):** Phase 2 auto-gotcha (`--apply-gotcha`, packet injection) — Dan approval. See `DECISIONS.md` D-18. **Q&A verify loop (D-22)** + **doc drift validate (D-23)** on `main`.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
