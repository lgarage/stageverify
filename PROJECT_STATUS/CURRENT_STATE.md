# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- Last shipped: **away-129** — away:plan draft suggestions when queue empty (`v0.0.34`, branch `cursor/away-126-129-batch-2aca`)
- Active Phase: **Location-first Phase 4 complete** → **Phase 5 implement blocked** (away-126 Fable+Grok AGREE FAIL): D14 — unauth vendor NMS occupancy CF omits other jobs' `plannedStagingLocationIds`; fix `getVendorStagingOccupancy` **[high-risk CF]** before Phase 5 code.
- **Harness (D-18):** Auto-gotcha Phase 0 **shipped** `c2109a8`; pending→indexer-on-ship works; Phase 2 auto-gotcha needs Dan approval.
- **Command interface (Phase 0):** `npm run command:slack` before drive — shipped `ad28000`.
- **Verify:** `verify:location-phase4` **15/15 PASS** local + **prod** (`v0.0.33`) — G1 release E2E (NMS G2+GL, release No) + list badges + interactive planned staging.
- Stack: React 19 + TS, Vite 8, Firebase 11.x → https://lgarage.github.io/stageverify · Firestore `stageverify-db`

## Active Blockers
1. **Minew ESL creds** — live ESL demo only (Phase 7).
2. **Shelving decision (Jake Korb)** — shop map / location IDs.
3. **Physical shop map** — not created (blocks sign printing only).
4. **Inbound Gmail CF + rules deploy** — Dan configures `GMAIL_PUBSUB_TOPIC` + GCP topic IAM.

## Immediate Next Step
- **Queue empty** — run `npm run away:plan` for draft away-130+ or queue D14 CF fix + Phase 5 resume.
- **Product:** Phase 4 prod verify gate **closed** (`v0.0.33`); Phase 5 implement blocked on D14 CF fix (`getVendorStagingOccupancy` planned-spot exclusion); push ingest **[high-risk]** — Dan approval.
- **Harness:** D-24 Fable↔Grok conferral universal **shipped** on branch; Phase 2 auto-gotcha (D-18) — Dan approval.

## Canonical references
- **Decisions:** `PROJECT_STATUS/DECISIONS.md` (+ `DECISIONS_ARCHIVE.md` when superseded)
- Handoff: `PROJECT_STATUS/archives/MINI_LIBRARIAN_HANDOFF.md` | Queue: `away-list.json` + `NEXT.md` | Validate: `npm run away:validate`

## Update Protocol
- Ship: `npm run away:ship` → `estimate-log.md` → `npm run away:validate` (auto-syncs CURRENT_STATE + Phase Tracker + roadmap from verify PASS) → commit.
