# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Location-first transition — Phase 3 core software slice shipped** (`v0.0.27`): `#/s?loc=` landing route, job-scoped vendor PIN (D14), post-PIN job delivery resolver, confirm-delivered hub, permanent sign generator on Zones, Settings `vendorSessionMinutes` unchanged (already editable). Sign **printing** still blocked on shop map (Jake Korb).
- **Vendor PIN (D14):** per-JOB PIN on `jobs.pinCode`/`pinHash`; session scope `job`; cross-job absence enforced server-side in `getJobVendorDeliveries`.
- **Reply ingest pilot (2026-07-07):** `emailReplyIngestEnabled` **ON** — controlled flag-on test only; push ingest broken (poll/manual sync works). Do NOT flip flag without Dan.
- Last shipped: **feat v0.0.27** — Location-first Phase 3 core: `#/s?loc=` + job PIN + location scan v2; CFs `getLocationPublicBranding`, `getJobVendorDeliveries`, `recordVendorLocationScan`; extended `verifyVendorPin`; `verify:location-scan`
- Stack + Data: React 19 + TS, Vite 8, Firebase 11.x, CF v2 → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Location-first Phase 4** — Need More Space v2 + planned-multi + release prompt per `docs/location-first-transition-spec.md` § Phase 4.

## Canonical references
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Ship history: `archives/ship-history.md` | Indexer: `dossier-index.json`, `npm run away:next --packet`
- Router: `MEMORY.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` timing → `npm run away:validate` → commit. Phase ships: sync `project_state.md` + `roadmap.md`.
