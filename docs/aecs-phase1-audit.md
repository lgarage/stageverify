# ACES Phase 1 Audit — StageVerify → Agent Control Engineering System

> **Branding (2026-06):** **ACES** is the product name (formerly **AECS** in earlier drafts). Code paths remain `aecs/` — see [`aecs/README.md`](../aecs/README.md).
> **Status:** ANALYSIS AND PLANNING ONLY — no migration, no behavior change, no installer  
> **Generated:** 2026-06-05  
> **Scope:** Host the **ACES builder prototype** in `c:\Projects\stageverify` while **StageVerify remains the primary shipped product** and first target project  
> **Companions:** [`portable-ai-os-report.md`](./portable-ai-os-report.md) (2026-06-04 portability scan), [`ai-os-extraction-phase-1-plan.md`](./ai-os-extraction-phase-1-plan.md) (brain-repo extraction proposal)  
> **Authority:** Meta/planning only — not live agent guidance. Live orchestration: `.cursor/rules/` + `agent-ops` skill.

---

## Executive Summary

StageVerify already functions as a **working agent control plane** (rules, gates, scouts, ship loop, memory tiers) bolted onto a product repo. The goal of **ACES** is to make that control plane **portable, installable, and auditable** without breaking StageVerify shipping behavior.

**Three-layer target (classification lens):**

| Layer | Purpose | Current home (mostly) |
|-------|---------|----------------------|
| **1 — Portable control-system core** | Reusable orchestration, rules templates, gates, skills, installer metadata; zero product facts | Split: `cursor-agent-brain/` (partial) + `.cursor/rules/` (contaminated) |
| **2 — ACES development memory** | ACES builder evolution (roadmap, architecture, decisions) | `aecs/dev/`, `docs/aecs/` — mixed with Layer 3 in places |
| **3 — Target-project memory** | Per-installed product state, overrides, lessons | `PROJECT_STATUS/`, `docs/project_state.md`, product `docs/` |

**Health rating:** ~6.5/10 for control-plane maturity (up from 5/10 pre–memory cleanup); **~3/10 for installability** (no manifest, no installer, hard-coded paths, dual-repo manual sync).

**Sonnet escalation:** Not used. Contradictions are documented and resolvable via explicit orchestration profiles; no ambiguous structural decision requires Sonnet arbitration in Phase 1.

---

## 1. Current-System Inventory

### 1.1 Rules (`.cursor/rules/` — 7 files, ~900 lines, all `alwaysApply: true`)

| File | Purpose | Authority | Portability | Contamination | Active/Stale | Dependencies |
|------|---------|-----------|-------------|---------------|--------------|--------------|
| `composer-orchestrator.mdc` | Session start, build gate, Playwright protocol, scope, escalation, session defaults | **De facto hub** for session behavior; claims override over global skill | **Project override** — pattern portable, content StageVerify-heavy | Pickup routes, Firebase auth, `stageverify-db`, `c:\Projects\stageverify`, MODEL_DOSSIER pointers | ✅ Active; ⚠️ overloaded (~234 lines) | `parallel-agent-strategy`, `ship-loop`, `model-*`, `PROJECT_STATUS/*`, `scripts/verify-*` |
| `parallel-agent-strategy.mdc` | Scout fan-out, synthesis, hard stops | Wins on parallelization; defers commit/deploy to `ship-loop` | **Portable core candidate** (template) | Title says `(stageverify)`; Dan-specific wording | ✅ Active (f7d2c44) | `model-dispatch-gate`, `composer-orchestrator`, Task tool |
| `ship-loop.mdc` | commit → push → `npm run deploy` → optional Firestore rules | Wins on commit/deploy vs user_rules | **Project override** from generic template | `stageverify-db`, gh-pages, overrides "commit only when requested" | ✅ Active | `composer-orchestrator`, `package.json` deploy |
| `session-cleanup-gate.mdc` | Dev server shutdown, PNG cleanup, port check | Mandatory cleanup | **Portable core candidate** | Port 5173–5176, pickup-verify PNG names | ✅ Active | Playwright workflow in orchestrator |
| `model-dispatch-gate.mdc` | Pre-edit archetype + tier announcement | Mandatory before edits | **Portable core candidate** | Composer billing note for stageverify | ✅ Active | Global tier table (agent-ops skill) |
| `model-audit-gate.mdc` | Post-change audit table + security gate timing | Mandatory after substantive work | **Portable core** (mostly generic) | Firestore/auth trigger examples | ✅ Active | `ship-loop`, Sonnet verifier |
| `agent-ops.mdc` | Bridge to global skill; outcome logging; Composer override | Declares **Composer profile**; overrides SKILL §10 | **Mixed** — bridge pattern portable, paths not | `C:\Projects\cursor-agent-brain`, `COMPUTERNAME`, Windows `cmd /c dir`, hard-coded outcome path | ✅ Active | `~/.cursor/skills/agent-ops`, brain repo git |

**Missing in repo:** `.cursor/trials.json` (still in `cursor-agent-brain/trials.json` — 100% stageverify tasks).

### 1.2 Skills (external)

| Asset | Location | Purpose | Portability | Contamination | Dependencies |
|-------|----------|---------|-------------|---------------|--------------|
| `agent-ops` skill | `~/.cursor/skills/agent-ops` → git `C:\Projects\cursor-agent-brain` | Global tier table, away-list, outcome schema, security gate pattern, Sonnet orchestration default | Intended **portable core** | Firebase `ProtectedRoute`, `Dan-Away`, Sonnet-only edit gate conflicts with Composer profile | Loaded every session via `agent-ops.mdc` |
| Cursor product skills | `~/.cursor/skills-cursor/` (15 skills) | Canvas, SDK, rules, skills authoring, etc. | ✅ Fully generic | None observed | Independent of stageverify |
| User rules (Cursor) | Cursor settings | "Commit only when requested" | N/A | Conflicts with `ship-loop.mdc` | **Resolved:** workspace `ship-loop` + `composer-orchestrator` explicitly override |

### 1.3 Workflows and gates

| Workflow | Enforced by | Trigger | Portable? |
|----------|-------------|---------|-----------|
| Session start read order | `composer-orchestrator`, `agent-ops` | Every coding session | Pattern yes; paths project-specific |
| Pre-edit gate (announce-and-go) | `model-dispatch-gate` | Before StrReplace/Write | ✅ Yes |
| Parallel scout pipeline | `parallel-agent-strategy` | Read-only multi-domain work | ✅ Yes (template) |
| Build gate | `composer-orchestrator` | After edits | Stack-specific (`npm run build`) |
| Playwright verify | `composer-orchestrator` | UI changes | Pattern portable; scripts local |
| Ship loop | `ship-loop` | Substantive changes | Template with deploy placeholders |
| Session cleanup | `session-cleanup-gate` | End of substantive task | Template with port/artifact placeholders |
| Model audit | `model-audit-gate` | Before declaring done | ✅ Yes |
| Security gate (scanner + Sonnet verifier) | `composer-orchestrator`, `model-audit-gate`, SKILL §11 | backend-write-critical, auth/T2 | Pattern portable; checklist needs decontamination |
| Outcome logging | `agent-ops.mdc`, SKILL §8 | End of substantive session | ✅ Schema portable; **path hard-coded** |
| Away-list execution | SKILL §4–6, `away-list.json` | Owner-away batches | ✅ Protocol portable |

### 1.4 Orchestration and model selection

| Source | Orchestrator | Worker default | Gate style | Status |
|--------|-------------|----------------|------------|--------|
| `cursor-agent-brain/SKILL.md` §10 | Sonnet 4.6 | Subagents only | Wait for proceed | Global default |
| `agent-ops.mdc` | Composer 2.5 Fast | Inline T0–T2 | Announce-and-go | **Project override (intentional, undocumented globally)** |
| `parallel-agent-strategy.mdc` | Composer 2.5 | Scouts + one executor | Synthesis first | Aligns with Composer profile |
| `model-dispatch-gate.mdc` | Composer 2.5 | Tier table (Composer rows) | Announce-and-go | Aligns with Composer profile |
| Global tier table (SKILL §2) | N/A | Seeded per archetype | Used for classification | **Learning loop active** (~70+ outcome rows) |

**Trial ladder:** `cursor-agent-brain/trials.json` — `backend-write-critical` at 3/5 clean passes with stageverify task names. Wrong repo location.

### 1.5 Memory tiers

| Tier | Location | Lines (est.) | Owner layer | Health |
|------|----------|--------------|-------------|--------|
| Hot snapshot | `PROJECT_STATUS/CURRENT_STATE.md` | ~30 | Layer 3 (target) | ✅ Within cap |
| Warm dossier | `PROJECT_STATUS/MODEL_DOSSIER.md` | ~170 | Layer 3 | ✅ Index-first pattern |
| Scope rejections | `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | Small | Layer 3 | ✅ |
| Away queue | `PROJECT_STATUS/away-list.json`, `away-status.json` | — | Layer 3 | ⚠️ Some stale entries |
| Phase truth | `docs/project_state.md` | ~200 | Layer 3 | ✅ Canonical |
| V2 roadmap | `docs/roadmap.md` | ~255 | Layer 3 (+ product) | ✅ |
| Product architecture | `docs/stageverify_v2_architecture.md` | ~630 | Layer 3 | ✅ Stable reference |
| Archives | `PROJECT_STATUS/archives/`, `docs/archives/` | — | Layer 3 history | ✅ Append-only |
| AECS planning | `docs/portable-ai-os-report.md`, `ai-os-extraction-phase-1-plan.md` | — | **Should be Layer 2** | ✅ This audit extends Layer 2 |
| Global bootstrap stubs | `cursor-agent-brain/bootstrap/*` | — | Layer 1 (partial) | ⚠️ No `.template` suffix; no rules templates yet |

### 1.6 Bootstrap and templates

| Asset | Location | Status |
|-------|----------|--------|
| PROJECT_STATUS stubs | `cursor-agent-brain/bootstrap/{CURRENT_STATE,MODEL_DOSSIER,away-list,away-status}.*` | Exist with `<REPO>` placeholders; not renamed `.template` |
| Rule templates | `cursor-agent-brain/bootstrap/rules/` | **Not created** (planned in extraction doc) |
| Orchestration profiles doc | `cursor-agent-brain/docs/orchestration-profiles.md` | **Not created** |
| Playwright auth bootstrap | `scripts/playwright-auth-setup.mjs` | Project-specific; reads `.env.local` |
| Installer / manifest | — | **Does not exist** |

### 1.7 Scripts (`scripts/` — 13 files)

| Script | Category | Layer | Notes |
|--------|----------|-------|-------|
| `verify-pickup-portal.mjs` | Interactive Playwright | Layer 3 | Critical path for pickup portal |
| `verify-receive.mjs` | Interactive Playwright | Layer 3 | Public receive flow |
| `verify-settings-staging.mjs` | Interactive Playwright | Layer 3 | Protected route |
| `verify-dispatcher-nav.mjs` | Interactive Playwright | Layer 3 | Nav IA guard |
| `verify-portal-layout.mjs` | Interactive Playwright | Layer 3 | Layout regression |
| `verify-vendor-demo.mjs` | Interactive Playwright | Layer 3 | Demo seed path |
| `playwright-auth-setup.mjs` | Auth bootstrap | Layer 3 | Uses `STAGEVERIFY_TEST_*` env vars |
| `clean-verify-artifacts.mjs` | Cleanup helper | Layer 1 candidate | Generic pattern |
| `resolveAppBase.mjs` | URL helper | Layer 3 | Prod base URL |
| `seed-vendor-demo-deliveries.mjs` | Data seed | Layer 3 | Writes to `stageverify-db` |
| `measure-typography.mjs`, `verify-typography.mjs`, `inspect-visual.mjs` | Legacy/compare | Layer 3 / archive | Reference HVAC tool URLs — low active use |

**`package.json` scripts:** `deploy` (gh-pages), `verify:*` and `verify:*:prod` — all StageVerify-bound. Duplicate `verify:dispatcher-nav` entry (harmless).

### 1.8 Test tools and Playwright

| Asset | Location | Status |
|-------|----------|--------|
| Playwright dependency | `package.json` devDependency | ✅ |
| Auth state | `playwright/.auth/state.json` (gitignored) | Manual setup; Firebase tokens ~1h TTL |
| Screenshot dir | `screenshots/` (gitignored) | Ephemeral verify artifacts |
| Prod verify pattern | `--base-url=https://lgarage.github.io/stageverify` | Hard-coded in npm scripts |

### 1.9 Ship procedures

Documented in `ship-loop.mdc` + `composer-orchestrator.mdc`:
1. `git status` → stage task files → conventional commit
2. `git push origin main`
3. `npm run deploy` (gh-pages)
4. Optional `firebase deploy --only firestore:rules --project stageverify-db`
5. `:prod` verify scripts after deploy
6. Brain repo outcome line (separate push)

### 1.10 Archives and reports

| Path | Type | Layer | Action |
|------|------|-------|--------|
| `PROJECT_STATUS/archives/MEMORY_ARCHITECTURE_ASSESSMENT.md` | Audit (archived) | Layer 2 history | Reference only |
| `PROJECT_STATUS/archives/AGENT_OPS_PHASE2.md` | Stale plan | Archive | Candidate removal after AECS supersedes |
| `PROJECT_STATUS/security-report-2026-06-02.md` | Security episodic | Layer 3 | Keep |
| `docs/archives/*` | Historical product docs | Layer 3 | Keep |

### 1.11 External / home-dir references

| Reference | Files | Risk |
|-----------|-------|------|
| `C:\Projects\cursor-agent-brain` | `agent-ops.mdc` | **HIGH** — machine-specific absolute path |
| `C:\Projects\stageverify` | `composer-orchestrator.mdc` | **MED** — breaks on repo move |
| `~/.cursor/skills/agent-ops` | `agent-ops.mdc` | **MED** — assumes symlink/copy install |
| `$env:COMPUTERNAME` → outcomes path | `agent-ops.mdc` | **LOW** — correct pattern but couples to brain repo layout |
| `cursor-agent-brain/trials.json` | SKILL.md, archives | **HIGH** — wrong ownership |
| `cursor-agent-brain/STATS.md` | `agent-ops.mdc` warning | **LOW** — documented stale |

### 1.12 `cursor-agent-brain` repo inventory

| Component | Portable core? | Contamination |
|-----------|---------------|---------------|
| `SKILL.md` | ✅ Framework | Firebase examples, Dan-Away, Sonnet-default without profile § |
| `archetypes.json` | ✅ | None |
| `scripts/recompute-tier-table.js` | ✅ | None |
| `.github/workflows/nightly-sync.yml` | ✅ | None |
| `outcomes/*.jsonl` | ✅ Schema | Content mostly `repo: stageverify` |
| `trials.json` | ❌ Wrong repo | 100% stageverify |
| `playbooks/*.md` | ✅ Structure | `security-review` triggers mention Firebase |
| `bootstrap/*` | ✅ Partial | Missing rules templates |
| `README.md` | ⚠️ | Wrong install path (`skills-cursor/` vs `skills/`) |

---

## 2. Boundary Classification

Legend: **PC** = portable core | **DM** = AECS dev memory | **TP** = target-project (StageVerify) | **EXT** = external dependency | **ARC** = archive | **REM** = candidate removal

### Directory-level

| Path | Classification | Notes |
|------|----------------|-------|
| `.cursor/rules/` | PC templates + TP overrides | Content stays until installer copies templates |
| `.cursor/trials.json` | TP (missing) | Should exist per project |
| `PROJECT_STATUS/CURRENT_STATE.md` | TP | Hot tier |
| `PROJECT_STATUS/MODEL_DOSSIER.md` | TP | Domain lessons |
| `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | TP | Product decisions |
| `PROJECT_STATUS/away-*.json` | TP | Per-project queue |
| `PROJECT_STATUS/ESL_*.md`, `PHYSICAL_DEPLOYMENT.md` | TP | Hardware/deploy |
| `PROJECT_STATUS/archives/` | ARC (+ some DM) | Session logs, old audits |
| `docs/project_state.md`, `docs/roadmap.md` | TP | Product phase |
| `docs/stageverify_v2_architecture.md` | TP | Product architecture |
| `docs/aecs-phase1-audit.md` | **DM** | Control-system evolution |
| `docs/portable-ai-os-report.md` | DM | Prior portability audit |
| `docs/ai-os-extraction-phase-1-plan.md` | DM | Brain-repo extraction plan |
| `scripts/verify-*.mjs` | TP | Route-specific |
| `scripts/playwright-auth-setup.mjs` | TP | Auth env vars |
| `scripts/clean-verify-artifacts.mjs` | PC candidate | Generic cleanup |
| `src/`, `functions/`, `firestore.rules` | TP (product) | **Out of AECS scope** |
| `cursor-agent-brain/` (external) | PC + contaminated | Separate git repo |
| `~/.cursor/skills/agent-ops` | EXT | Runtime load path |
| `~/.cursor/skills-cursor/` | EXT | Cursor product skills |
| `playwright/.auth/` | TP runtime | Gitignored secrets state |

### File-level priority (top 20)

| File | Class | Rationale |
|------|-------|-----------|
| `model-audit-gate.mdc` | PC | Generic audit protocol |
| `model-dispatch-gate.mdc` | PC → TP override | Template + billing profile fill-in |
| `parallel-agent-strategy.mdc` | PC → TP override | Scout pattern generic |
| `session-cleanup-gate.mdc` | PC → TP override | Ports/artifacts parameterized |
| `ship-loop.mdc` | TP override | Deploy commands project-specific |
| `agent-ops.mdc` | Mixed | Bridge + hard-coded paths |
| `composer-orchestrator.mdc` | TP | StageVerify Playwright + product pointers |
| `cursor-agent-brain/SKILL.md` | PC (needs decontamination) | Global framework |
| `cursor-agent-brain/trials.json` | TP (misplaced) | Move to `.cursor/trials.json` |
| `PROJECT_STATUS/CURRENT_STATE.md` | TP | |
| `docs/aecs-phase1-audit.md` | DM | |
| `package.json` deploy/verify scripts | TP | |
| `scripts/verify-pickup-portal.mjs` | TP | |
| `PROJECT_STATUS/archives/roadmap-sync.mdc` | REM | Superseded; archived copy |
| `PROJECT_STATUS/archives/AGENT_OPS_PHASE2.md` | ARC/REM | Stale "no backend" |

---

## 3. Authority Map

### 3.1 Current hierarchy (as loaded by Cursor)

```
Cursor system prompt
    └── User rules (global) — "commit only when requested"
            └── Workspace rules (.cursor/rules/*.mdc, alwaysApply)
                    ├── ship-loop.mdc — WINS on commit/push/deploy vs user_rules
                    ├── parallel-agent-strategy.mdc — WINS on fan-out vs serialize
                    ├── composer-orchestrator.mdc — WINS on session defaults vs other rules
                    ├── model-dispatch-gate.mdc — WINS on pre-edit tier pick
                    ├── model-audit-gate.mdc — WINS on post-change audit
                    ├── session-cleanup-gate.mdc — WINS on cleanup
                    └── agent-ops.mdc — bridges + declares Composer override
                            └── agent-ops SKILL.md (~/.cursor/skills/agent-ops)
                                    └── CONFLICT: SKILL §10 Sonnet orchestrator vs Composer override
```

### 3.2 Recommended hierarchy (post-AECS)

```
AECS core manifest (version, profile, install paths)     [NEW — Layer 1]
    └── Orchestration profile (sonnet-default | composer-default)  [NEW — explicit]
            └── Portable gate templates (dispatch, audit, cleanup, parallel)  [Layer 1]
                    └── Project bridge (.cursor/rules/agent-ops.mdc)  [Layer 3 override]
                            └── Project orchestrator extension (composer-orchestrator.mdc)  [Layer 3]
                                    └── Ship loop (project deploy bindings)  [Layer 3]
                                            └── Target PROJECT_STATUS + docs/project_state  [Layer 3]
                                                    └── Global SKILL.md tier table + outcome schema  [Layer 1]
```

**Conflict flags (current):**

| Behavior | Claimants | Severity | Resolution |
|----------|-----------|----------|------------|
| Who orchestrates? | SKILL §10 vs `agent-ops.mdc` vs `parallel-agent-strategy` | **HIGH** | Orchestration profiles § in SKILL; explicit profile in bridge |
| Commit without ask? | `ship-loop` vs user_rules | **MED** | Documented override — keep; installer sets profile |
| Security verifier model | SKILL §11 (Gemini scan + Opus verify) vs stageverify (Sonnet verify) | **MED** | Profile B documents Sonnet verifier; align SKILL checklist |
| Opus vs Composer for T3 | SKILL locked Opus vs Composer trial | **MED** | trials.json per project; SKILL references `<project>/.cursor/trials.json` |
| Phase truth source | `project_state.md` vs `roadmap.md` vs `CURRENT_STATE` | **LOW** (mostly fixed) | Authority chain in `roadmap.md` header — keep |
| Parallel vs multitask scope | `composer-orchestrator` tight scope vs `parallel-agent-strategy` scouts | **LOW** | Already clarified in parallel-agent-strategy § |

### 3.3 Domain authority table

| Domain | Current authority | Recommended |
|--------|-------------------|-------------|
| Orchestration | `composer-orchestrator.mdc` (de facto) | Profile declaration in bridge; orchestrator extension for project |
| Rules / gates | `.cursor/rules/` collective | Core templates + project overrides via installer |
| Memory hot tier | `CURRENT_STATE.md` | Unchanged (TP) |
| Phase / roadmap | `docs/project_state.md` + `docs/roadmap.md` | Unchanged (TP) |
| Model escalation | `model-dispatch-gate` + `parallel-agent-strategy` | Core template + profile |
| Testing (UI) | `composer-orchestrator` Playwright § | Project extension only |
| Shipping | `ship-loop.mdc` | Project override from template |
| Self-modification (rules) | `composer-orchestrator` Rule File Self-Maintenance | **Human approval** for core; Composer may align project rules |

---

## 4. Portability Risk Report

Ranked by **risk × difficulty** (1 = worst blocker).

| Rank | Blocker | Severity | Difficulty | Evidence |
|------|---------|----------|------------|----------|
| 1 | **Dual orchestration policy** (SKILL Sonnet vs Composer override) | HIGH | MED | Agents load both; prompt-injection / instruction-conflict risk |
| 2 | **No installer / manifest / version pin** | HIGH | HIGH | Manual copy of bootstrap; no collision detection |
| 3 | **Hard-coded absolute paths** (`C:\Projects\...`) | HIGH | LOW | `agent-ops.mdc`, `composer-orchestrator.mdc` |
| 4 | **`trials.json` in wrong repo** | HIGH | LOW | Brain repo holds stageverify trial data |
| 5 | **SKILL.md product contamination** | MED | MED | Firebase, ProtectedRoute, Dan-Away |
| 6 | **Split-brain memory (2 git repos)** | MED | MED | Outcomes in brain; rules in project; manual dual push |
| 7 | **Install path confusion** (`skills` vs `skills-cursor`) | MED | LOW | README wrong path |
| 8 | **No dry-run / diff / rollback for rule updates** | MED | HIGH | Silent overwrite risk on `~/.cursor/skills` |
| 9 | **composer-orchestrator hub overload** | MED | MED | Product + procedure + Playwright in one file |
| 10 | **Machine-specific shell note** (Windows `cmd /c dir`) | LOW | LOW | Valid override but not parameterized |
| 11 | **STATS.md stale / misleading** | LOW | LOW | Documented; undermines trust in learning loop |
| 12 | **Playwright auth manual setup** | LOW | MED | `.env.local` secrets; no generic template |

### Security findings (portability lens)

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| S1 | Outcome logging PowerShell snippet writes to fixed brain path — supply-chain if brain repo compromised | MED | Integrity / path trust |
| S2 | No installer signature or checksum — `~/.cursor/skills` overwrite | HIGH | Supply-chain / silent overwrite |
| S3 | `ship-loop` mandates push to `origin/main` without branch guard — privilege / accident risk | MED | Unsafe writes |
| S4 | Playwright auth stores Firebase tokens in gitignored `playwright/.auth/` — OK if ignored; leak if committed | MED | Secrets exposure |
| S5 | `seed-vendor-demo-deliveries.mjs` writes prod Firestore — agent could run if rule not scoped | MED | Unsafe writes |
| S6 | Instruction conflict (Sonnet vs Composer) — unpredictable agent behavior | HIGH | Prompt-injection / authority |
| S7 | No audit log for rule self-modification | MED | Auditability |
| S8 | Partial-failure: brain push succeeds, project push fails — split state | MED | Partial-failure recovery |
| S9 | Away-list `preApproved: true` items auto-execute — blast radius if queue poisoned | MED | Privilege escalation |
| S10 | Firebase rules deploy coupled to ship — correct for security; must stay human-gated for new projects | LOW | Least-privilege (good pattern) |

---

## 5. Target Architecture Proposal (PROPOSAL ONLY)

### 5.1 Future repo layout — `stageverify` as AECS host

```
stageverify/                              # AECS development repo (this repo)
├── aecs/                                 # [NEW] Portable control-system core (Layer 1 source)
│   ├── manifest.json                     # Version, files, checksums, profile defaults
│   ├── core/
│   │   ├── rules/                        # Portable .mdc templates (no product facts)
│   │   ├── playbooks/                    # Generic playbook stubs
│   │   └── schemas/                      # trials.json, away-list, outcome row schemas
│   ├── installer/                        # install.mjs, dry-run, diff, rollback
│   └── docs/                             # AECS architecture, profiles, upgrade notes
├── targets/
│   └── stageverify/                      # [NEW] Target overlay manifest (Layer 3 bindings)
│       ├── rules.overrides/              # ship-loop, composer-orchestrator fragments
│       ├── verify-scripts/               # Pointer manifest to scripts/verify-*
│       └── project-memory/               # Pointer to PROJECT_STATUS + docs/project_state
├── .cursor/rules/                        # INSTALLED snapshot (generated; git-tracked for now)
├── PROJECT_STATUS/                       # Layer 3 — StageVerify hot memory
├── docs/
│   ├── project_state.md                # Layer 3
│   ├── roadmap.md                      # Layer 3 product + gates
│   └── aecs-phase1-audit.md            # Layer 2
├── src/                                  # Layer 3 product (unchanged)
└── scripts/verify-*.mjs                # Layer 3 verification
```

### 5.2 External repos (unchanged relationship)

```
cursor-agent-brain/                       # Global learning + tier table (Layer 1 extension)
├── SKILL.md                              # Decontaminated; orchestration profiles
├── outcomes/<machine>.jsonl              # Cross-project learning
├── archetypes.json
└── bootstrap/                            # Seeding templates (or symlink to aecs/core)

<target-project>/
├── .cursor/rules/                        # Installed from aecs installer + target overlay
├── .cursor/trials.json                   # Per-project trials
└── PROJECT_STATUS/                       # Per-project memory
```

### 5.3 Orchestration profiles (explicit)

| Profile | Orchestrator | Gate | Use case |
|---------|-------------|------|----------|
| `sonnet-default` | Sonnet 4.6 | Wait for proceed | Default for new projects |
| `composer-default` | Composer 2.5 Fast | Announce-and-go | Billing-optimized (StageVerify) |

StageVerify keeps `composer-default` — no behavior change in Phase 2.

---

## 6. Installer and Update Requirements

### 6.1 Install (greenfield target project)

| Requirement | Description |
|-------------|-------------|
| **Detect** | Verify Cursor workspace; check for existing `.cursor/rules/` |
| **Dry-run** | List files to write; show placeholder substitutions |
| **Collision detection** | Hash compare; prompt on modified files |
| **Profile select** | `sonnet-default` or `composer-default` |
| **Placeholders** | `<REPO>`, `<BRAIN_REPO_PATH>`, `<DEPLOY_COMMAND>`, `<RULES_DEPLOY>`, `<DEV_PORT>`, `<ORCHESTRATOR_MODEL>` |
| **PROJECT_STATUS seed** | Copy templates; never overwrite non-empty without flag |
| **trials.json** | Create empty schema if backend expected |
| **Verify** | Post-install grep: no unresolved `<PLACEHOLDER>`; rules load count |
| **Manifest** | Write `.cursor/aecs-manifest.json` with version + profile + file hashes |

### 6.2 Update

| Requirement | Description |
|-------------|-------------|
| **Version tracking** | Semver in `aecs/manifest.json`; per-target `.cursor/aecs-manifest.json` |
| **Diff preview** | Show rule changes vs installed hashes |
| **Backup** | Timestamped copy to `.cursor/aecs-backup/<version>/` |
| **Rollback** | Restore from backup manifest |
| **Override preservation** | Three-way merge: core template vs target overlay vs local edits |
| **Migration notes** | `aecs/docs/UPGRADE.md` per version |
| **Integrity** | SHA-256 per shipped rule file (optional signature later) |

### 6.3 Security requirements for installer

- Never write outside project root without explicit flag
- Never copy `.env*` or `playwright/.auth/`
- Require human confirmation for `alwaysApply: true` rule overwrites
- Log all install/update actions to `aecs-install.log` (gitignored)
- No `curl | bash` — local script only, vendored from repo

---

## 7. Phase 2 Implementation Plan (reorganization WITHOUT behavior change)

**Goal:** Introduce `aecs/` directory structure and relocate portable assets — **no rule semantics change**, no product code change.

### 7.1 Sequence (recommended)

| Step | Action | Risk | Rollback |
|------|--------|------|----------|
| 1 | Tag `pre-aecs-phase2` on stageverify + cursor-agent-brain | LOW | `git reset --hard tag` |
| 2 | Create `aecs/manifest.json` (v0.1.0) inventorying current `.cursor/rules/` | LOW | Delete `aecs/` |
| 3 | Copy portable rules to `aecs/core/rules/*.mdc.template` (from live files) | LOW | Delete copies |
| 4 | Create `targets/stageverify/` overlay manifest listing project-only lines | LOW | Delete |
| 5 | Move `trials.json` brain → `stageverify/.cursor/trials.json` | MED | Restore brain copy |
| 6 | Apply brain-repo decontamination per `ai-os-extraction-phase-1-plan.md` | MED | `git checkout` brain |
| 7 | Parameterize paths in `agent-ops.mdc` (`<BRAIN_REPO_PATH>` env or manifest) | MED | Revert mdc |
| 8 | Add `docs/orchestration-profiles.md` to brain repo | LOW | Delete |
| 9 | Add header note to `composer-orchestrator.mdc` (split deferred) | LOW | Revert one line |
| 10 | Validation gate: `npm run build`; grep placeholders; agent dry-run session | MED | — |
| 11 | **Do NOT** split composer-orchestrator yet | — | — |
| 12 | **Do NOT** implement installer executable yet — manifest only | — | — |

### 7.2 File categories to move (Phase 2)

| From | To (proposal) | Behavior change? |
|------|---------------|------------------|
| `.cursor/rules/model-audit-gate.mdc` | `aecs/core/rules/` + sync back | No |
| `.cursor/rules/model-dispatch-gate.mdc` | template + project fill | No |
| `.cursor/rules/parallel-agent-strategy.mdc` | template + project fill | No |
| `.cursor/rules/session-cleanup-gate.mdc` | template + project fill | No |
| `cursor-agent-brain/trials.json` | `.cursor/trials.json` | No — path only |
| `docs/portable-ai-os-report.md` | `aecs/docs/` or keep `docs/` | No |
| Product-specific orchestrator content | `targets/stageverify/` | No |

### 7.3 Compatibility risks

- Cursor loads `.cursor/rules/` only — **installed path must remain** until installer copies out
- Changing `alwaysApply` filenames breaks muscle memory — keep filenames stable
- Path parameterization in `agent-ops.mdc` must still resolve on Dan's machine
- Dual-repo push order: project commit first, brain outcome second

### 7.4 Gates before Phase 3 (installer implementation)

- [ ] `aecs/manifest.json` lists all rule files with hashes
- [ ] Orchestration profile documented in brain SKILL.md
- [ ] Zero `C:\Projects\` hard-codes in portable templates (project bridge may keep until Phase 3)
- [ ] `trials.json` in `.cursor/`; brain copy deleted
- [ ] Grep brain SKILL for `stageverify`, `ProtectedRoute`, `Dan-Away` → zero in examples
- [ ] One manual bootstrap test on empty repo (dry copy)
- [ ] Dan approves profile strategy

---

## 8. Decisions Requiring Dan

Only genuine unresolved decisions — not false choices where evidence picks a winner.

| # | Decision | Why unresolved | Evidence lean |
|---|----------|----------------|---------------|
| 1 | **Repo identity:** Evolve `stageverify` repo into AECS host vs split new `aecs` repo | Affects git history, gh-pages URL, collaborator mental model | **Lean:** keep single repo with `aecs/` prefix — less disruption; product stays in `src/` |
| 2 | **Brain repo relationship:** Merge `cursor-agent-brain` into `aecs/` monorepo vs stay separate | Learning loop independence vs install simplicity | **Lean:** stay separate for now — nightly tier recompute already works |
| 3 | **Installer runtime:** Node CLI vs PowerShell vs Cursor skill | Windows primary dev environment | **Lean:** Node `.mjs` in `aecs/installer/` — matches scripts/ pattern |
| 4 | **When to split `composer-orchestrator.mdc`** | Stability vs maintainability | **Lean:** defer until after trials move + SKILL decontamination (prior plan §2) |
| 5 | **Profile default for *new* projects** | Cost vs quality tradeoff | **Lean:** `sonnet-default` global; StageVerify keeps `composer-default` |
| 6 | **Commit authority on fresh targets** | user_rules vs ship-loop | **Lean:** installer asks; default `commit-on-ship` opt-in per target |
| 7 | **AECS Phase 2 timing vs StageVerify Phase 2 product work** | Competing NOW tracks | **Needs Dan:** parallel or pause? |

**Not requiring Dan (evidence picks winner):**

- Orchestration profiles section in SKILL.md — required (blocker #1)
- `trials.json` per-project — required (wrong repo today)
- Keep StageVerify Playwright scripts in `scripts/` — project-specific by nature
- `model-audit-gate.mdc` portable as-is — already generic

---

## 9. StageVerify Contamination Audit

| Location | Content | Classification |
|----------|---------|----------------|
| `composer-orchestrator.mdc` | Pickup portal, dispatcher nav, Firebase login | **Legitimate project override** |
| `ship-loop.mdc` | `stageverify-db`, gh-pages | **Legitimate project override** |
| `agent-ops.mdc` | `repo: stageverify` in outcome JSON | **Legitimate project override** |
| `parallel-agent-strategy.mdc` | Title `(stageverify)` | **Accidental contamination** — cosmetic |
| `cursor-agent-brain/trials.json` | `receiving-scan-feature`, etc. | **Accidental contamination** — wrong repo |
| `cursor-agent-brain/SKILL.md` | ProtectedRoute, Firestore, Dan-Away | **Accidental contamination** in global asset |
| `cursor-agent-brain/outcomes/*.jsonl` | Mostly `repo: stageverify` | **Legitimate historical reference** — schema is global |
| `MODEL_DOSSIER.md` | QR, pickup lessons | **Legitimate project memory** |
| `scripts/verify-*.mjs` | Routes, DOM selectors | **Legitimate project override** |
| `docs/stageverify_v2_architecture.md` | Product name | **Legitimate project memory** |
| `bootstrap/CURRENT_STATE.md` | `<REPO>` placeholder | **Reusable pattern** — correct |
| `measure-typography.mjs` | HVAC tool URL | **Historical reference** — archive candidate |
| `model-dispatch-gate.mdc` | "billing priority (stageverify)" | **Legitimate project override** |

---

## 10. Self-Update Boundary

| Change type | Composer | Sonnet | Security review | Human | Version bump | Migration | Rollback prep |
|-------------|----------|--------|-----------------|-------|--------------|-----------|---------------|
| Portable core template wording | ✅ | — | — | Notify | Patch | Note in UPGRADE.md | Backup manifest |
| Orchestration profile switch | ✅ | Review if authority conflict | — | **Approve** | Minor | Required | Rule backup |
| `ship-loop` deploy target change | ✅ | — | — | **Approve** | — | — | git revert |
| Firestore rules / auth paths | ✅ implement | **Verifier required** | **Required** | Notify | — | — | rules backup |
| Installer script (new) | ✅ | Review | **Required** | **Approve** | Minor | Required | Tag pre-install |
| Brain SKILL decontamination | ✅ | — | Scan checklist | Notify | Minor | Required | git tag |
| `composer-orchestrator` split | ✅ | Optional | — | **Approve** | — | Required | Single atomic commit |
| Moving `aecs/` directories | ✅ | — | — | Notify | Minor | Required | `pre-aecs-phase2` tag |
| cursor-agent-brain merge | — | **Required** | **Required** | **Approve** | Major | Required | Full backup |

---

## 11. Current Behavior Preservation (must not break)

| Behavior | Enforced by | Phase 2 constraint |
|----------|-------------|-------------------|
| Composer 2.5 orchestrator + inline T0–T2 | `agent-ops`, `model-dispatch`, `parallel-agent` | Profile stays `composer-default` |
| Parallel read-only scouts default | `parallel-agent-strategy` | No semantic edits |
| Announce-and-go pre-edit gate | `model-dispatch-gate` | Keep |
| Build gate (`npm run build`) | `composer-orchestrator` | Keep |
| Playwright before UI ship | `composer-orchestrator` | Keep scripts paths |
| Ship loop: commit → push → deploy | `ship-loop` | Keep commands |
| Sonnet security verifier before push (T3/T2 auth) | `model-audit`, `composer-orchestrator` | Keep |
| Session cleanup (dev server, PNGs) | `session-cleanup-gate` | Keep |
| CURRENT_STATE first read | `composer-orchestrator` | Keep |
| MODEL_DOSSIER index-first | `composer-orchestrator` | Keep |
| USER_SCOPE_REJECTIONS nav guard | `composer-orchestrator` | Keep |
| Outcome log to brain repo | `agent-ops` | Keep path working until parameterized |
| Workspace rules override global skill | `composer-orchestrator` § | Keep explicit |
| Opus locked fallback only | Multiple rules | Keep aligned |

---

## 12. Relationship to Prior Planning

| Document | Role after this audit |
|----------|----------------------|
| `docs/portable-ai-os-report.md` | Prior portability scan — still valid; superseded for Phase 2 entry by **this doc §7** |
| `docs/ai-os-extraction-phase-1-plan.md` | Brain-repo extraction steps — **subset** of AECS Phase 2 steps 5–6 |
| `PROJECT_STATUS/archives/MEMORY_ARCHITECTURE_ASSESSMENT.md` | Historical — many items actioned |

**AECS Phase 1 (this document)** = full-system audit with three-layer model, installer requirements, and security lens.  
**AI OS Extraction Phase 1** = narrower brain-repo decontamination — execute as part of AECS Phase 2 steps.  
**Phase 2 implementation plan:** [`docs/aecs/phase-2-plan.md`](./aecs/phase-2-plan.md) (binding decisions applied; Sonnet PASS WITH NOTES).

---

## 13. Recommended Phase 2 Entry Point

1. **Approve** repo-as-AECS-host strategy (Decision #1).
2. **Execute** brain-repo extraction steps 1–6 from `ai-os-extraction-phase-1-plan.md` (trials move + SKILL profiles).
3. **Create** `aecs/manifest.json` + `aecs/core/rules/*.template` without changing live `.cursor/rules/` behavior.
4. **Defer** installer CLI and `composer-orchestrator` split until manifest validates.

---

## Appendix — Task-Type Confidence Log

| Task type | Model | Confidence | Note |
|-----------|-------|------------|------|
| `read-only-analysis` (AECS Phase 1 audit) | Composer 2.5 Fast | 94% | Full repo + brain repo read access |
| `docs-governance` (roadmap cross-ref) | Composer 2.5 Fast | 96% | Minimal factual edit |

---

*Phase 1 complete. No files moved. No behavior changed. No installer implemented.*
