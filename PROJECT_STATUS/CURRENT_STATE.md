# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Location-first transition — Phase 4 verify hardening** (`v0.0.30`): interactive `verify:location-phase4` (NMS + planned-staging + list badges); release-prompt CF + full G1→G4 E2E still pending Dan approval.
- **Vendor PIN (D14):** per-JOB PIN on `jobs.pinCode`/`pinHash`; session scope `job`; cross-job absence enforced server-side in `getJobVendorDeliveries`.
- **Reply ingest pilot (2026-07-07):** `emailReplyIngestEnabled` **ON** — controlled flag-on test only; push ingest broken (poll/manual sync works). Do NOT flip flag without Dan.
- Last shipped: **away-118..121 + away-123** — Phase 4 verify hardening, e2e-smoke pickup leg, invoice fixtures, orphan verify npm entries
- Stack + Data: React 19 + TS, Vite 8, Firebase 11.x, CF v2 → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Post-queue:** see `docs/project_state.md` immediate next steps.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Ship history: `archives/ship-history.md` | Indexer: `dossier-index.json`, `npm run away:next --packet`
- Router: `MEMORY.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` timing → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
