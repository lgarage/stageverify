# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier ? hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` ? concern ? file ? when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` ? scope wins on conflict; load only for scope disputes.

## Snapshot
- Active Phase: **Location-first transition — Phase 2 complete** (privacy hardening: `firestore.rules` auth-only reads on deliveries/items/jobs/POs; session/token-gated CF reads/writes; `vendorPinVerifier` offline fallback removed). Phase 5→6 vendor email ingest pilot remains live in background.
- **Vendor PIN REVISED to job-scoped (Dan 2026-07-08, D14):** PIN per JOB, not per vendor/company — wrong-spot scan shows only that job's spots; overflow shows only empty unassigned spots. Read spec § Job-scoped vendor PIN before Phases 2–4 work.
- **Reply ingest pilot (2026-07-07):** `emailReplyIngestEnabled` **ON** — controlled flag-on test only; push ingest broken (poll/manual sync works). Do NOT flip flag without Dan. Handoff: `PROJECT_STATUS/archives/HANDOFF_VENDOR_EMAIL_2026-07-07.md`; gotchas: `gotcha-map.json` vendor-reply-ingest-pilot / gmail-push-payload.
- **Security gate evidence (2026-07-07):** `PROJECT_STATUS/archives/SECURITY_GATE_AUDIT_2026-07-07.md` — subagent + `security-gate-id` required; do not claim Sonnet/Fable without invocation evidence; RC-3 model execution unverified; gotcha `security-gate-evidence`.
- Last shipped: **feat v0.0.26** — Location-first Phase 2: Firestore privacy hardening; vendor/pickup data behind session/token CFs; offline PIN verifier removed; negative privacy verify script
- Stack + Data: React 19 + TS, Vite 8, Firebase 11.x, CF v2 → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** ? live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** ? shop map / location IDs.
3. **Physical shop map** ? not created.
4. **Inbound Gmail CF + rules deploy** ? `triggerInboundGmailSyncCallable` shipped; Dan still configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Location-first Phase 3** — permanent location entry + vendor scan v2 (`#/s?loc=`) per `docs/location-first-transition-spec.md` § Phase 3. Sign printing blocked on shop map + shelving decision (Jake Korb).

## Canonical references
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Ship history: `archives/ship-history.md` | Indexer: `dossier-index.json`, `indexer-memory.json`, `npm run away:next --packet`
- Router: `MEMORY.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` ? `estimate-log.md` timing ? `npm run away:validate` ? commit. Phase ships: sync `project_state.md` + `roadmap.md`.
