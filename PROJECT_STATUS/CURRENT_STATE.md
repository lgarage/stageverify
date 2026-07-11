# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Last shipped: **demo removal** — stop auto-seed; hide ORD-001..006 from dispatcher list; UI uses live invoice imports + vendor email events only (`v0.0.33`).
- Active Phase: **Location-first Phase 4** (`v0.0.32`): `releasePlannedStagingLocation` CF deployed; vendor release prompt + drawer audit shipped **`5e935fe`** (Sonnet gate PASS `57701217`).
- **Harness (D-18):** Auto-gotcha Phase 0 **shipped** `c2109a8`; pending→indexer-on-ship works; Phase 2 auto-gotcha needs Dan approval.
- **Command interface (Phase 0):** `npm run command:slack` before drive — shipped `ad28000`.
- **Verify:** `verify:location-phase4` **11/11 PASS** local — G1 release E2E (NMS G2+GL, release No) + list badges + interactive planned staging.
- Stack: React 19 + TS, Vite 8, Firebase 11.x → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — Dan configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Firestore cleanup:** run `npm run cleanup:demo-data` (dry-run) then `npm run cleanup:demo-data:confirm` to delete legacy seed docs from `stageverify-db`.
- **Product:** Run `verify:location-phase4:prod` after gh-pages deploy; push ingest still **[high-risk]** — Dan approval.
- **Harness (D-18):** Phase 2 auto-gotcha (`--apply-gotcha`, packet injection) — Dan approval. See `DECISIONS.md` D-18.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
