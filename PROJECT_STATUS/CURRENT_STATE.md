# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Location-first transition — Phase 4** (`v0.0.31`): release-prompt CF + vendor UI + verify hardening shipped; G1→G2+GL E2E after CF deploy.
- **Harness V1 Freeze (D-16):** additions need pain tickets (charter: HARNESS_V1_FREEZE.md); deletions always legal.
- **Vendor PIN (D14):** per-JOB PIN on `jobs.pinCode`/`pinHash`; session scope `job`; cross-job absence enforced server-side in `getJobVendorDeliveries`.
- **Reply ingest pilot (2026-07-07):** `emailReplyIngestEnabled` **ON** — controlled flag-on test only; push ingest broken (poll/manual sync works). Do NOT flip flag without Dan.
- **Command interface (Phase 0):** `npm run command:slack` before drive — Slack transport over harness state.
- Stack + Data: React 19 + TS, Vite 8, Firebase 11.x, CF v2 → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Product:** location-first Phase 4 release-prompt **shipped** (`releasePlannedStagingLocation` CF + vendor release prompt + drawer audit). Push ingest **[high-risk]** still awaits Dan approval. **Dan-side:** shop map, shelving (Jake), Gmail topic config.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Ship history: `archives/ship-history.md` | Indexer: `dossier-index.json`, `npm run away:next --packet`
- Router: `MEMORY.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` timing → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
