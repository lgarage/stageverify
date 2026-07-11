# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Last shipped: **D-18 auto-gotcha Phase 0** (standalone chore)
- Active Phase: **Location-first Phase 4** (`v0.0.31`): `releasePlannedStagingLocation` CF deployed; vendor release prompt + drawer audit shipped **`5e935fe`** (Sonnet gate PASS `57701217`).
- **Harness in-flight (D-18):** Auto-gotcha learning Phase 0 **shipped** — spawn-child-timeout classifier, `spawn-sync-patch-exit` gotcha, vfl-013/014 corrected, demo cases 8–9.
- **Command interface (Phase 0):** `npm run command:slack` before drive — shipped `ad28000`.
- **Verify:** `verify:location-phase4` **10/11 PASS** after `process.exit(0)` on patch child; **1 FAIL** G1 release E2E (NMS "no ground spots" — fixture/occupancy, not CF hang).
- Stack: React 19 + TS, Vite 8, Firebase 11.x → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — Dan configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Harness (D-18):** Phase 0 done — next: fix G1 release E2E fixture → 11/11 `verify:location-phase4`; Phase 1 pending (pending→indexer promotion unchanged). See `DECISIONS.md` D-18.
- **Product:** Retry `verify:location-phase4:prod` when gh-pages bundle propagates; push ingest still **[high-risk]** — Dan approval.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
