# ACES Design Report — Agent Control Engineering System

> **Status:** Living design document (2026-07-12) — Grok-verified PASS (93/100)  
> **Audience:** Dan, future agents, and anyone adopting or extending the harness  
> **Authority:** Meta/planning — describes the system; live behavior is enforced by `.cursor/rules/` + `agent-ops` skill until an installer target adopts ACES outputs  
> **Naming:** **ACES** is the product name. Code paths and npm scripts still use **`aecs/`** (legacy AECS prefix) until a dedicated rename release.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What ACES is (and is not)](#2-what-aces-is-and-is-not)
3. [Three-layer architecture](#3-three-layer-architecture)
4. [Authority and instruction hierarchy](#4-authority-and-instruction-hierarchy)
5. [Orchestration model](#5-orchestration-model)
6. [Model routing and tiers](#6-model-routing-and-tiers)
7. [Verification ladder](#7-verification-ladder)
8. [Ship loop and two-tier risk model](#8-ship-loop-and-two-tier-risk-model)
9. [Parallel agent strategy](#9-parallel-agent-strategy)
10. [Memory system and tiers](#10-memory-system-and-tiers)
11. [Mini Librarian (Phase 2 partial ACES)](#11-mini-librarian-phase-2-partial-aces)
12. [Learning loop](#12-learning-loop)
13. [Away queue and batch protocol](#13-away-queue-and-batch-protocol)
14. [Session lifecycle](#14-session-lifecycle)
15. [Self-modification boundaries](#15-self-modification-boundaries)
16. [Portable core, installer, updater, export](#16-portable-core-installer-updater-export)
17. [External dependencies (cursor-agent-brain)](#17-external-dependencies-cursor-agent-brain)
18. [Harness V1 freeze and governance](#18-harness-v1-freeze-and-governance)
19. [Platform parity (desktop, mobile, cloud)](#19-platform-parity-desktop-mobile-cloud)
20. [Current maturity and roadmap phases](#20-current-maturity-and-roadmap-phases)
21. [Glossary](#21-glossary)
22. [Source index](#22-source-index)

---

## 1. Executive summary

**ACES (Agent Control Engineering System)** is Dan's name for the **agent harness** — the complete control plane that governs how AI agents update code, verify work, learn from failures, take structured notes, ship changes, and coordinate multiple models.

In the StageVerify repository, ACES exists in two forms simultaneously:

| Form | Role |
|------|------|
| **Live harness** | `.cursor/rules/*.mdc` (always-applied workspace rules), npm scripts (`away:*`, `context:*`, `verify:*`), and `PROJECT_STATUS/` memory files — what agents actually follow today |
| **ACES builder prototype** | `aecs/` directory tree — portable rule templates, installer/updater/export CLIs, schemas, and dev memory — aimed at making the harness **installable and auditable** on other git repos |

**StageVerify is the product.** **ACES is the builder hosted inside the same repo.** ACES meta-work must not block StageVerify shipping unless Dan explicitly requests harness work.

Health snapshot (from Phase 1 audit, updated by later phases):

- **Control-plane maturity:** ~6.5/10 — rich gates, memory tiers, verification ladder, away protocol
- **Installability:** improved to v0.2.0 local export/install/update/rollback — still **local-only**, unsigned, not production-hardened for arbitrary targets
- **Full ACES Librarian plane:** **deferred** — a "Mini Librarian" indexer/retriever runs today via npm scripts; the full Librarian role hierarchy in `librarian-plan.md` remains design-only

---

## 2. What ACES is (and is not)

### ACES **is**

- A **rules + gates + scripts + memory** system that constrains agent behavior
- An **orchestration profile** (StageVerify uses `composer-default`: Composer 2.5 Fast orchestrates inline; Sonnet/Fable/Grok for verification roles)
- A **verification ladder** — mechanical checks (build, Playwright, npm verify scripts) plus cheap model verifiers (Grok) and expensive gates (Sonnet security, Fable work verifier)
- A **memory architecture** — hot/warm/cold tiers, away queue, decision registry, lessons learned, gotcha map, estimate log
- A **learning loop** — outcomes in `cursor-agent-brain`, indexer overflow, auto-capture from verify/deploy failures, promotion to gotcha-map and lessons
- A **portability program** — manifest, templates, installer, updater, rollback, export (Phases 2–5)

### ACES **is not**

- The StageVerify product (`src/`, `functions/`, Firestore rules for product behavior)
- A replacement for Composer as the default implementer (Composer implements; verifiers verify)
- The full ACES Librarian agent (that role does not orchestrate software development — see §11)
- Fully autonomous self-modification of portable core without human approval
- A signed, remote-downloadable package (Phase 5 is local-only)

---

## 3. Three-layer architecture

ACES classifies every asset into one of three layers. This is the foundational mental model from the Phase 1 audit.

| Layer | Name | Purpose | Typical locations |
|-------|------|---------|-------------------|
| **1** | Portable control-system core | Reusable orchestration templates, gate patterns, schemas, installer metadata — **zero product facts** | `aecs/core/`, `cursor-agent-brain/SKILL.md`, `cursor-agent-brain/archetypes.json`, global playbooks |
| **2** | ACES development memory | How ACES itself evolves — plans, phase status, architecture decisions | `aecs/dev/`, `docs/aecs/`, `docs/aecs-phase1-audit.md` |
| **3** | Target-project memory | Per-product state, overrides, lessons, queue, scope | `PROJECT_STATUS/`, `docs/project_state.md`, `docs/roadmap.md`, `.cursor/rules/composer-orchestrator.mdc` (project extension), `scripts/verify-*.mjs` |

### Side-by-side install model (Phase 2+)

- **Source of truth for portable rules:** `aecs/core/rules/*.mdc.template`
- **Runtime (what Cursor loads):** `.cursor/rules/*.mdc`
- **Install state:** `.cursor/aecs/installed-manifest.json`, `ownership.json`, backups

Cursor only reads `.cursor/rules/` — the installer copies/substitutes templates into that path; it does not merge templates into live rules as the primary workflow.

### Contamination vs legitimate override

| Content in project rules | Classification |
|--------------------------|----------------|
| Pickup routes, Firebase project id, gh-pages URL | **Legitimate Layer 3 override** |
| `(stageverify)` in parallel-agent title | Cosmetic contamination — harmless |
| `trials.json` in brain repo with stageverify task names | **Accidental (historical)** — moved to `.cursor/trials.json` per project (Phase 2); brain copy should be deleted |
| Firebase examples in global SKILL.md | **Accidental contamination** in Layer 1 — brain decontamination target |

---

## 4. Authority and instruction hierarchy

When instructions conflict, this order applies (simplified from Phase 1 audit + subsequent decisions):

```
Cursor system prompt
└── User rules (global — e.g. "commit only when requested")
    └── Workspace rules (.cursor/rules/*.mdc, alwaysApply: true)
        ├── ship-loop.mdc — WINS on commit/push/deploy vs generic user rules
        ├── parallel-agent-strategy.mdc — WINS on fan-out vs serialize
        ├── composer-orchestrator.mdc — WINS on session defaults
        ├── model-gates.mdc — pre-edit tiers, verification ladder, fix-closure
        ├── security-review-gate.mdc — Sonnet security gate invocation
        ├── answer-quality.mdc — pre-present quality for plans/handoffs
        ├── time-awareness.mdc — budget filter, away vs active mode
        ├── product-guardrails.mdc — Minew NDA, vendor QR requirements
        ├── mvp-completion-report.mdc — MVP % line in work replies
        ├── mobile-ui-ship.mdc — D-27 mobile UI merge+deploy (overrides cloud branch-only default)
        └── agent-ops.mdc — bridge to global skill; declares composer-default profile
            └── agent-ops SKILL.md (~/.cursor/skills/agent-ops → cursor-agent-brain)
```

**Product authority chain** (what to build, not how agents behave):

| Concern | Authority |
|---------|-----------|
| Product vision / scope disputes | `PROJECT_STATUS/svscope_simple.md` |
| Phase truth / deployment state | `docs/project_state.md` |
| Priorities / NOW-NEXT-LATER | `docs/roadmap.md` (subordinate to CURRENT_STATE for "what's next") |
| Hot snapshot | `PROJECT_STATUS/CURRENT_STATE.md` |
| MVP % and exit criteria | `PROJECT_STATUS/MVP_PATH.md` |
| Harness decisions | `PROJECT_STATUS/DECISIONS.md` |

**Planning rule:** `CURRENT_STATE.md` + `npm run away:next` queue head **win** over `docs/roadmap.md` narrative alone for "what's next to build."

---

## 5. Orchestration model

### Profiles

| Profile | Orchestrator | Gate style | Default for |
|---------|-------------|------------|-------------|
| `sonnet-default` | Sonnet 4.6 | Wait for proceed | New ACES targets (manifest default) |
| `composer-default` | Composer 2.5 Fast | Announce-and-go | **StageVerify** (billing-optimized) |

StageVerify intentionally overrides the global `agent-ops` SKILL §10 Sonnet-default via `agent-ops.mdc` — documented as an orchestration profile, not an accident.

### Role separation (mandatory)

| Role | Actor | May edit repo? | May commit/ship? |
|------|-------|----------------|------------------|
| **Coordinator / orchestrator** | Composer 2.5 (parent session) | Yes | Yes — owns full ship loop |
| **Scout** | `explore` or readonly Task subagent | No | No |
| **Domain executor** | Composer inline or Task (disjoint paths only) | Yes (scoped paths) | No — coordinator merges and ships |
| **Security verifier** | Sonnet 4.6 Task (`security-review`) | No | No — verdict only |
| **Ship / Repair / Planning / Q&A verifier** | Grok 4.5 Fast Task (readonly) | No | No |
| **Stall advisor** | Grok 4.5 Fast (readonly) | No | No |
| **Work verifier** | Fable 5 Task (readonly) | No | No |
| **Diagnose-only escalation** | Sonnet 4.6 after 2-fail rule | No | No — Composer implements after |

**Hard rule:** Subagents do not commit, push, deploy, or mark away items done. Fable and Sonnet on diagnosis/verify paths never implement.

### Pre-edit gate (announce-and-go)

Before any file edit, the orchestrator states:

1. **Archetype** (from `cursor-agent-brain/archetypes.json`)
2. **Tier** T0–T3 + default model
3. **Dispatch** — inline Composer vs escalate
4. **Parallel plan** — scouts if applicable

Then loads lesson slice if type/subtype known: `npm run context:lessons -- --type <type>/<subtype>`

---

## 6. Model routing and tiers

From `model-gates.mdc`:

| Tier | Archetypes | Default worker |
|------|------------|----------------|
| **T0** | `ui-component`, `css-restyle`, `docs-update`, scout/inventory | Composer 2.5 Fast inline |
| **T1** | `multi-file-feature`, `type-refactor`, `service-logic` | Composer 2.5 Fast inline |
| **T2** | Multi-file with auth/routing/Firestore reads | Composer 2.5 Fast inline (escalate if uncertain) |
| **T3** | `backend-write-critical` (rules, CF writes, schema) | Composer 2.5 Fast inline (trial) + **Sonnet security gate before push** |

### Escalation triggers (Composer → Sonnet)

- Security gate on backend-write-critical / auth / rules (mandatory before push)
- Second failed fix on same task (2-fail diagnose-only rule)
- Same failure fingerprint twice → **Grok stall-advisor first**, then Sonnet if still stuck
- Architecture unclear after synthesis + one Composer pass

### Opus

Locked fallback only if Sonnet security gate returns HIGH that Composer cannot resolve — not for routine T3 implementation.

### Global tier table learning

`cursor-agent-brain/outcomes/<machine>.jsonl` feeds nightly tier recompute. Archetype slugs validated against `archetypes.json`. Session-end outcome line appended to brain repo (separate push from project).

---

## 7. Verification ladder

The verification ladder assigns each check to the cheapest capable actor. **D-02** established the base ladder (tier 0 mechanical checks, Grok ship/critical reviewer, Sonnet security, Fable work verifier). **D-19 through D-22** extended it with specialized Grok loops:

| Tier | Actor | Role | When auto-invoked |
|------|-------|------|-------------------|
| **0** | Composer + scripts | Builder + mechanical checks: `npm run build`, `away:validate`, `verify:*`, diff-vs-scope, mandatory report lines | Always |
| **1** | Grok — **Ship Verifier** | Post-ship scope/correctness + missed-security-gate check | After every substantive ship (path-classified) |
| **1b** | Grok — **Stall Advisor** (D-19) | Same-failure pivot — hypotheses only | 2nd consecutive same fingerprint |
| **1c** | Grok — **Repair Verifier** (D-20) | Pre-close on Dan repair intent | repair/fix/debug/try again |
| **1d** | Grok — **Planning Verifier** (D-21) | Planning/roadmap/queue accuracy | "what's next", away planning, ranked options |
| **1e** | Grok — **Q&A Verifier** (D-22) | Non-trivial Q&A accuracy | how/why/where/explain/recommend |
| **2** | Sonnet 4.6 | Security gate | CF/auth/rules/T3; also if Ship Verifier flags missing gate |
| **3** | Fable 5 — **Work Verifier** | Spec phase boundaries, architecture ambiguity | Fable-spec phases, "fable verify", Ship Verifier escalation |

### Evidence standard (D-03)

Every verifier claim requires **Task id + model line** in the completion report. Missing id = **NOT RUN** — not PASS.

Mandatory report lines include: `ship-verifier:`, `repair-verifier:`, `planning-verifier:`, `qa-verifier:`, `stall-advisor:`, `security-gate-id:`, `work-verifier:`, `fix-verified:` (per closed finding).

### Fix-closure rule (D-04)

Whichever model reported an issue **re-verifies** the fix before closure. Composer self-attesting "fixed" never closes a finding. Max cycles vary by loop (repair: 3; planning: 3; Q&A: 2).

### Critical Reviewer (Grok)

Before presenting new gates, multi-phase plans (≥3 phases / ≥5 files), architecture decisions with ≥2 options, or new workflow roles — one readonly Grok Task. Subject to Harness V1 Freeze reopening criteria (D-16).

---

## 8. Ship loop and two-tier risk model

From `ship-loop.mdc` (D-01):

### Fast-safe (default — ship without asking)

**Paths:** `src/` (except auth/session/token/route-guard logic), `public/`, `scripts/verify-*`, `docs/`, `PROJECT_STATUS/`, `.cursor/rules/`, root `package.json` (ordinary dependency bumps only — not scripts/deploy wiring), routine service logic without auth/rules surface.

**Edge rulings:** Cloud Functions read-path changes are fast-safe to implement; `firebase deploy --only functions` is high-risk. Auth/session/token logic anywhere (including under `src/`) is high-risk entirely.

**Sequence:**

0. Version bump in `package.json` (when bundle deploys)
1. `npm run build` + Playwright/`verify:*` for affected routes
2. Security gate if triggered (before push)
3. Stage task files → conventional commit
4. `git push origin main` (or feature branch on cloud — see §19)
5. `npm run deploy` (gh-pages when frontend changed)
6. Firebase deploy when CF/rules changed (high-risk approval required)
7. Production `:prod` verify scripts
8. Completion report with evidence lines

### High-risk (STOP before implementation)

**Paths/changes:** `firestore.rules`, `functions/**` deploy, `functions/package.json`, auth/route guards, secrets/config, billing, data deletion, schema migrations, Gmail watch, root `package.json` deploy wiring, any `src/` auth/session/token logic.

Requires Dan's explicit approval **before** implement. Sonnet security gate still mandatory before push regardless of approval.

**Misclassifying down is the failure mode** — when ambiguous, classify high-risk and ask.

### UI verification (not optional for visible changes)

Build alone is insufficient. Interactive flows need `scripts/verify-*.mjs`. Layout/copy changes need before/after screenshots or covered verify script. Protected routes need Playwright auth setup.

### Session cleanup (done gate)

Stop dev servers, kill background shells, delete ephemeral PNGs, confirm ports clear, clean git status before declaring done.

---

## 9. Parallel agent strategy

From `parallel-agent-strategy.mdc`:

**Default:** Parallel **read-only scouts** (2–4) for independent domains. **Single executor** for implementation unless one task spans clearly **disjoint file domains**.

**Building ≠ max parallel:**

- Away items: **one at a time** — never parallelize ordered away IDs
- Deploy: serial — coordinator only
- Same-file edits: never parallel
- `backend-write-critical` implementation: never parallel

### Planning question protocol

Triggers: "what's next", roadmap, away planning, ranked options.

1. Repo sync: `git fetch origin main && git pull origin main`
2. Scout A: `npm run away:next -- --minimal` first
3. Expand to B–D scouts if needed (roadmap, code gaps, verify coverage)
4. Synthesize before any edit
5. Grok Planning Verifier → PASS before present
6. Answer quality cross-check

### File-ownership parallel batches

When one item touches ≥2 disjoint domains (e.g. pickup UI + receive UI), coordinator may assign up to 4 domain executors with explicit allowed/forbidden paths. Coordinator merges shared types (`models.ts`, `firestoreService.ts`, `App.tsx`) serially, then one build/verify/ship.

---

## 10. Memory system and tiers

### Hot tier (session start — STOP here for routine work)

| File | Cap | Purpose |
|------|-----|---------|
| `PROJECT_STATUS/CURRENT_STATE.md` | ~30 lines | Phase, blockers, last shipped, immediate next |
| `PROJECT_STATUS/MEMORY.md` | ~70 lines | Router — concern → file → when to read |

Do **not** load full `MODEL_DOSSIER.md` or `svscope_simple.md` at session start unless scope dispute.

### Warm tier (on demand)

| File | Purpose |
|------|---------|
| `PROJECT_STATUS/MVP_PATH.md` | MVP %, exit criteria, fastest path |
| `PROJECT_STATUS/MODEL_DOSSIER.md` | Index-first domain rules — slice via `npm run dossier:slice -- --tag <tag>` |
| `PROJECT_STATUS/away-list.json` | Active queue |
| `PROJECT_STATUS/DECISIONS.md` | Harness + product decisions (D-NN) |
| `npm run away:next -- --packet` | Queue brief + gate warnings + lesson/indexer injection |

### Cold tier

| File | Purpose |
|------|---------|
| `PROJECT_STATUS/archives/` | Historical audits, dossier notes, handoffs |
| `docs/stageverify_v2_architecture.md` | Product architecture reference |
| `PROJECT_STATUS/LIBRARIAN_LESSONS.md` archive rotation | Old lesson bullets |

### Authority chain for phase truth

`docs/project_state.md` + verify PASS auto-sync (D-23) → `CURRENT_STATE.md` + Phase Tracker + `roadmap.md`. Agents must not hand-edit phase closure when auto-sync applies.

### Handoff protocol (D-08, D-13)

When Dan says "prepare for new conv":

1. Record decisions in `DECISIONS.md`
2. Update `CURRENT_STATE.md` with in-flight task, verdict + commit hash per completed item, tier classifications
3. Commit + push
4. New conv bootstraps from `CURRENT_STATE.md` + `MEMORY.md` + `DECISIONS.md` — **no transcript mining**, **trust recorded verdicts** (D-13 names CURRENT_STATE + DECISIONS as the trust anchor; live orchestrator also loads MEMORY.md as the router)

### Decision registry

Format: `D-NN (date) [harness|product]: decision — because why.`

Superseded decisions → `DECISIONS_ARCHIVE.md`.

---

## 11. Mini Librarian (Phase 2 partial ACES)

The **full ACES Librarian** (Retriever, Indexer, Note Taker, Archivist, Verifier, Context Packet Builder, Specialist Agents) is **designed but not deployed** as separate agents. See `docs/aecs/librarian-plan.md`.

**What runs today** is the **Mini Librarian** — npm scripts + JSON indexes that implement indexer/retriever/context-packet behavior without a separate Librarian orchestrator:

| Capability | Implementation |
|------------|----------------|
| Router | `PROJECT_STATUS/MEMORY.md` |
| Dossier index | `PROJECT_STATUS/dossier-index.json` + `npm run dossier:slice` |
| Task gotcha routing | `PROJECT_STATUS/gotcha-map.json` + `npm run context:gotcha` |
| Lessons § slices | `librarian-lessons-index.json` + `npm run context:lessons` |
| Context packets | `npm run context:packet`, `npm run away:next -- --packet` |
| Indexer overflow | `indexer-memory.json` + `npm run indexer:ingest` |
| Drift validation | `npm run away:validate` (index line ranges, anchor drift) |
| Timing audit | `PROJECT_STATUS/estimate-log.md` (not in away-status.json) |

**Pattern:** Index first → slice only what you need — never ingest whole markdown files to find one section.

### Planned full Librarian rules (not live)

- Librarian **does not orchestrate software development**
- Librarian **does not replace Composer**
- Note Taker produces **drafts only** — Librarian decides, Verifier confirms
- Archivist runs periodically — never auto-delete without verification

---

## 12. Learning loop

Multiple interconnected mechanisms capture and replay lessons:

### 12.1 Global outcomes (cursor-agent-brain)

At session end (substantive work), append one JSONL row to `cursor-agent-brain/outcomes/<machine>.jsonl`:

```json
{"date":"YYYY-MM-DD","repo":"stageverify","archetype":"<slug>","model":"<slug>","tier":"T?","confStart":N,"confAfter":N,"outcome":"ok|fail|escalate","machine":"<host>","note":"<=80 chars"}
```

Nightly GitHub Action recomputes tier table. `STATS.md` may be stale — count actual `.jsonl` files for Phase-2 readiness.

### 12.2 Ship-time learning (`away:ship`)

```bash
npm run away:ship -- --id away-NNN --note "..." --learned "..."
# or --failure + --fix
```

Auto-parses `--note` for: `root cause:`, `fix:`, `prod verify fail`, `stale gh-pages`, `Pages build stuck`.

### 12.3 Verify/deploy failure auto-queue

- `verify:*` failures → `learning-pending.json` via `run-verify-with-learning.mjs` wrapper
- `npm run deploy` failures → same pending store via `deploy-gh-pages.mjs`
- `away:ship` merges pending into `indexer-memory.json`

### 12.4 Indexer (`indexer-memory.json`)

Structured overflow with `triggerTerms`, type/subtype, categories (lesson, decision, timing signal, future idea).

- Retrieval: top 2 matches injected in `away:next -- --packet`
- Promotion to `gotcha-map.json`: high-signal task triggers only (`--apply-gotcha` after review)
- Promotion to `LIBRARIAN_LESSONS.md`: via `--category lesson` or `lessons:append`

### 12.5 LIBRARIAN_LESSONS.md

Rolling SSOT for agent lessons (≤40 active lines). Domain-deep detail remains in `MODEL_DOSSIER.md` § agent-lessons.

### 12.6 gotcha-map.json

Maps task keywords → orchestrator on-demand steps 6–8 (MODEL_DOSSIER index, lessons §, USER_SCOPE_REJECTIONS). Supplements lessons file — routes **when** to load, not the full lesson text.

### 12.7 Estimate calibration

`estimate-log.md` records worker `task-start`/`task-finish` timestamps. Librarian verifies `actualElapsedMin` from timestamp math. Every 15 rows: `npm run estimate:audit`.

### 12.8 Auto-gotcha phases (D-18)

Phase 0–1: `classifyVerifyFailure`, manual `gotcha-map` entry, demo regressions; pending→indexer on `away:ship` unchanged. **Phase 2** auto `--apply-gotcha` and broadened packet injection require **explicit Dan approval** — not enabled by default.

---

## 13. Away queue and batch protocol

Canonical spec: `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md`

### Four phases (mandatory order)

| Phase | Trigger | Action |
|-------|---------|--------|
| **Plan** | "what should I build while I'm away", overnight first question | `npm run away:plan` — suggest only; **no queue writes** |
| **Approve** | "go build it", "queue it" | Confirm scope |
| **Queue** | After approval | Write `away-list.json`; high-risk needs `danApproved: true` |
| **Execute** | Queue ready | `npm run away:batch` — one item at a time |

### Per-item loop

1. `task-start` timestamp (before any edit)
2. Implement (scouts → synthesis → executor)
3. All `verifyBeforeNext` commands
4. Security gate if `escalateWhen` / high-risk
5. `task-finish` timestamp
6. `npm run away:ship -- --id ... --commit ... --note ...`
7. `npm run away:validate`
8. Commit, push, deploy
9. Ship Verifier (Grok)
10. Halt batch on failure

### Key files

| File | Role |
|------|------|
| `away-list.json` | Queued items, verify commands, dependencies, risk tier |
| `away-status.json` | Append-only built/blocked/deferred log |
| `estimate-log.md` | Timing audit SSOT |
| `NEXT.md` | Human-readable queue head (auto-synced) |

---

## 14. Session lifecycle

### Start

1. Load `time-awareness.mdc` — ask Active vs Away planning if mode unclear
2. Read `CURRENT_STATE.md`
3. Read `MEMORY.md`
4. On-demand: planning scouts, dossier slices, gotcha context, MVP_PATH for planning questions

### During work

- Scope echo before tools
- Pre-edit gate announcement
- Build after edits
- Playwright for UI
- Parallel scouts default for read-only multi-domain work

### End (substantive)

1. Completion report: **What we did** (plain language first)
2. MVP completion line if MVP-scoped (D-25)
3. Timing table from worker timestamps
4. Model audit table
5. Verifier evidence lines
6. `gotchas:` line
7. `decisions:` line
8. Brain outcome JSONL row (desktop)
9. Session cleanup

### Answer quality gate

Before presenting plans, handoffs, recommendations: cross-check authoritative sources, time-bound filter, Grok verifier where triggered. Never ship first draft to Dan for planning questions.

---

## 15. Self-modification boundaries

From Phase 1 audit §10 + Harness V1 Freeze:

| Change type | Composer | Sonnet | Human approval |
|-------------|----------|--------|----------------|
| Portable core template wording | ✅ | — | Notify |
| Orchestration profile switch | ✅ | Review if conflict | **Approve** |
| `ship-loop` deploy target | ✅ | — | **Approve** |
| Firestore rules / auth | ✅ implement | Verifier required | **Approve before implement** (D-01 high-risk STOP) |
| New installer script | ✅ | Review | **Approve** + security review |
| New `.cursor/rules/` file or >30 line rule edit | ✅ | — | Critical Reviewer (Grok) |
| Harness additions during V1 freeze | — | — | **Pain log ≥2× or incident** (D-16) |

**Deletions/compressions:** always legal during V1 freeze. **Additions** need evidence of repeated pain.

---

## 16. Portable core, installer, updater, export

**Manifest:** `aecs/manifest.json` — v0.2.0, file hashes, profile defaults, project-owned paths.

### npm scripts (dev host)

| Script | Purpose |
|--------|---------|
| `aecs:install` / `aecs:install:write` | Greenfield install (dry-run default) |
| `aecs:verify` | Read-only install verification |
| `aecs:update` / `aecs:update:write` | Update installed target from local source |
| `aecs:rollback` / `aecs:rollback:write` | Restore from backup transaction |
| `aecs:export` / `aecs:export:write` | Phase 5 portable release package |
| `aecs:test` | Installer + updater + export regression tests |

### Live vs template divergence

Portable core ships separate `model-audit-gate.mdc.template` and `model-dispatch-gate.mdc.template`. StageVerify's live `.cursor/rules/model-gates.mdc` merges dispatch, audit, verification ladder, and fix-closure into one alwaysApply file — a project evolution beyond the v0.2.0 template set.

### Core templates (Layer 1)

- `model-audit-gate.mdc.template`
- `model-dispatch-gate.mdc.template`
- `parallel-agent-strategy.mdc.template`
- `session-cleanup-gate.mdc.template`
- `agent-ops-bridge.mdc.template`
- `ship-loop.mdc.template`
- Schemas: `trials.schema.json`, `outcome-row.schema.json`

### Safety properties (Phase 4)

- Dry-run default; `--write` required for mutations
- Backups at `.cursor/aecs/backups/<transactionId>/`
- In-progress sentinels block concurrent writes (fail-closed)
- Downgrade blocked unless `--allow-downgrade`
- **StageVerify dev host is NOT a normal update target**

### Phase 5 export

Produces `aecs-release-<version>/` — local-only, unsigned, excludes `aecs/dev/**`. Operator guide: `aecs/release/OPERATOR-GUIDE.md`.

---

## 17. External dependencies (cursor-agent-brain)

Separate git repo: `https://github.com/lgarage/cursor-agent-brain`

| Component | Role |
|-----------|------|
| `SKILL.md` | Global tier table, away protocol, outcome schema |
| `archetypes.json` | Archetype slug validation |
| `outcomes/*.jsonl` | Cross-project learning |
| `scripts/recompute-tier-table.js` | Nightly tier update |
| `bootstrap/*` | PROJECT_STATUS seed templates |
| `~/.cursor/skills/agent-ops` | Runtime symlink to brain repo |

**Dual-push workflow:** Project commit first, brain outcome second. Paths still partially hard-coded on Windows (`C:\Projects\cursor-agent-brain`) — parameterization target for future phases.

**Relationship decision (Phase 2):** Stay separate repos for now — nightly sync already works.

---

## 18. Harness V1 freeze and governance

**Charter:** `PROJECT_STATUS/HARNESS_V1_FREEZE.md` (D-16)

### Frozen surface (complete — do not add without pain ticket)

Two-tier ship · verification ladder + fix-closure · repair/planning/Q&A verify loops · security gate · away queue · decision registry · handoff · evidence standard · scope discipline · product guardrails · parallel-agent strategy · completion-report contract · doc drift validate (D-23).

### Asymmetric rule (D-15, D-16)

- **Deletions:** always legal
- **Additions:** need ≥2× logged pain, security/production incident, measured bottleneck, or real customer gap

### Pain log

Voice-cheap: `"log pain: <what you wanted and couldn't do>"` → dated line in HARNESS_V1_FREEZE.md.

Recent pain events drove: stall-advisor (D-19), platform parity + repair loop (D-20), planning verify (D-21), Q&A verify (D-22), doc drift validate (D-23), MVP reporting (D-25), mobile UI merge+deploy (D-27).

### Fable as harness gate (D-17)

Fable 5 role includes rejecting speculative harness work that delays StageVerify MVP.

---

## 19. Platform parity (desktop, mobile, cloud)

**D-20:** Identical harness on desktop Windows PC, mobile Cursor, and cloud VM.

Same rules files in repo — commit rule updates so all clients pull the same `alwaysApply` behavior.

### Cloud-only exceptions (AGENTS.md)

| Exception | Reason |
|-----------|--------|
| Secrets via Cursor Environments UI | Dan must set test credentials |
| Prefer feature branch + PR | Cloud agents don't push `main`/deploy by default unless prompt allows |
| D-27 mobile UI exception | Enforced by `mobile-ui-ship.mdc` (alwaysApply) — mobile UI changes merge+deploy after verify without a separate "ship it" |
| Brain outcome logging | `agent-ops.mdc` paths are Windows-oriented (`C:\Projects\cursor-agent-brain`); cloud VM sessions often skip session-end brain JSONL push |

---

## 20. Current maturity and roadmap phases

| Phase | Status | Deliverable |
|-------|--------|-------------|
| **Phase 1** | ✅ Complete | Audit, three-layer model, installer requirements — `docs/aecs-phase1-audit.md` |
| **Phase 2** | Structurally landed; residuals open | `aecs/` tree, manifest, templates, `.cursor/aecs/`, `.cursor/trials.json` present; brain decontamination + path parameterization remain — `docs/aecs/phase-2-plan.md` |
| **Phase 3** | Implemented v0.1 | Installer + verify CLI — `docs/aecs/phase-3-plan.md` |
| **Phase 4** | Implemented v0.2 | Updater + rollback — `aecs/dev/docs/phase-4-status.md` |
| **Phase 5** | Implemented v0.2.0 export | Local export package — `docs/aecs/phase-5-plan.md`, `aecs/dev/docs/phase-5-status.md` |
| **Full Librarian** | **Deferred** | Role hierarchy in `librarian-plan.md`; mini indexer live |

**Roadmap placement:** ACES builder = **LATER** in `docs/roadmap.md` — StageVerify MVP takes priority.

**composer-orchestrator split:** Deferred to Phase 3+ per `docs/aecs/phase-2-plan.md` — do not split until orchestration profiles stable.

---

## 21. Glossary

| Term | Meaning |
|------|---------|
| **ACES** | Agent Control Engineering System — the harness product name |
| **AECS** | Legacy acronym; directory prefix `aecs/` unchanged |
| **Harness** | Synonym for ACES live rules + scripts + memory |
| **Orchestrator** | Parent Composer session that owns ship loop |
| **Scout** | Read-only subagent for exploration/planning |
| **Archetype** | Task classification slug (e.g. `ui-component`, `backend-write-critical`) |
| **Tier** | Risk/complexity band T0–T3 |
| **Ship loop** | build → verify → commit → push → deploy → prod verify |
| **Fix-closure** | Same model re-verifies before finding closes |
| **Hot tier** | CURRENT_STATE + MEMORY — session start STOP |
| **Mini Librarian** | Indexer/retriever scripts — not full Librarian agent |
| **Away item** | Queued work unit in `away-list.json` (e.g. `away-129`) |
| **Evidence line** | Report footer with Task id proving verifier ran |
| **NOT RUN** | Verifier required but no Task id — blocks next ship |
| **Pain ticket** | Dated entry in HARNESS_V1_FREEZE justifying harness addition |
| **composer-default** | StageVerify orchestration profile |
| **Brain repo** | `cursor-agent-brain` — global learning |

---

## 22. Source index

| Topic | Primary source |
|-------|----------------|
| ACES overview | `aecs/README.md` |
| Phase 1 audit | `docs/aecs-phase1-audit.md` |
| Phase plans | `docs/aecs/phase-2-plan.md` … `phase-5-plan.md` |
| Live orchestration | `.cursor/rules/composer-orchestrator.mdc` |
| Model gates / ladder | `.cursor/rules/model-gates.mdc` |
| Ship loop | `.cursor/rules/ship-loop.mdc` |
| Parallel agents | `.cursor/rules/parallel-agent-strategy.mdc` |
| Security gate | `.cursor/rules/security-review-gate.mdc` |
| Answer quality | `.cursor/rules/answer-quality.mdc` |
| Time awareness | `.cursor/rules/time-awareness.mdc` |
| Mobile UI ship | `.cursor/rules/mobile-ui-ship.mdc` |
| MVP completion line | `.cursor/rules/mvp-completion-report.mdc` |
| Memory router | `PROJECT_STATUS/MEMORY.md` |
| Away protocol | `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md` |
| Librarian design | `docs/aecs/librarian-plan.md` |
| Harness freeze | `PROJECT_STATUS/HARNESS_V1_FREEZE.md` |
| Decisions | `PROJECT_STATUS/DECISIONS.md` |
| Cloud parity | `AGENTS.md` |
| Operator guide | `aecs/release/OPERATOR-GUIDE.md` |
| Manifest | `aecs/manifest.json` |

---

*Document generated for ACES design review. Live behavior always defers to `.cursor/rules/` and shipped npm scripts when this document and runtime diverge.*
