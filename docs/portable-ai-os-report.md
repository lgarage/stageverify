# Portable AI OS — Portability Assessment Report

> **Generated:** 2026-06-04  
> **Context:** Post-Phase-1 stageverify memory cleanup (commit `f7d2c44`)  
> **Analyst role:** Senior AI Systems Architect  
> **Scope:** Documentation and memory architecture only — no application code changes  
> **Authority:** Meta/portability analysis only — not live agent guidance. Phase truth: `docs/roadmap.md` header chain.

---

## 1. Executive Summary

StageVerify's agent memory system works well enough to ship features, but it is not yet a portable AI operating system. The information Dan needs exists — it is scattered, duplicated in places, and mixed with project-specific data inside assets that should be reusable across repos.

**Post-Phase-1 status (2026-06-04):**

- `docs/project_state.md` is now the canonical phase truth; root `roadmap.md` and `PROJECT_PLAN.md` were removed.
- Stale files moved to `PROJECT_STATUS/archives/` and `docs/archives/`.
- `parallel-agent-strategy.mdc` added — Composer 2.5 Fast is the default orchestrator for stageverify.
- **Overall health rating: ~6.5/10** (up from 5/10 pre-cleanup).

**The central portability blocker:** A dual orchestration policy conflict. The global `cursor-agent-brain/SKILL.md` declares **Sonnet 4.6 as the orchestrator** (§10), while stageverify's `.cursor/rules/` declare **Composer 2.5 Fast as orchestrator and default worker**. Agents loading both rule sets must reconcile contradictory instructions every session — wasting context and producing inconsistent behavior.

**Verdict on Dan's hypothesis ("the info exists, it's just scattered"):** **CONFIRMED**, with an addendum: some "global" assets are stageverify-specific in disguise. Extraction Phase 1 (see companion plan doc) addresses the highest-ROI separation without touching application code.

**Top 3 actions by ROI:**

| Rank | Action | Impact |
|------|--------|--------|
| 1 | Reconcile global SKILL orchestration policy with per-repo override pattern | Ends dual-orchestrator confusion; unlocks portable OS |
| 2 | Move `trials.json` and strip stageverify examples from global SKILL | Separates project trial data from cross-repo framework |
| 3 | Add bootstrap rule templates for new projects | Enables one-session project seeding without stageverify knowledge |

---

## 2. Current State Inventory

Post-Phase-1 inventory of agent-relevant memory assets.

| Location | Category | Files (est.) | Lines (est.) | Health | Notes |
|----------|----------|-------------|-------------|--------|-------|
| `.cursor/rules/` | Procedural (alwaysApply) | 7 active | ~900 | ⚠️ Good but overloaded hub | `composer-orchestrator.mdc` ~230 lines; `roadmap-sync.mdc` deleted in Phase 1 |
| `PROJECT_STATUS/` | Hot-tier working memory | 10 active + archives | ~700 | ✅ Improved | Caps enforced; stale files archived |
| `docs/` | Semantic / phase truth | 4 active + archives | ~1,200 | ✅ Improved | `project_state.md` canonical; duplicates archived |
| `scripts/` | Procedural (executable) | 10 registered + archives | ~1,400 | ✅ Good | Orphaned typography scripts archived |
| `src/` (rationale comments) | Semantic (inline) | ~8 files | ~200 inline | ✅ Good | MODEL_DOSSIER cross-refs in key files |
| `cursor-agent-brain/` | Global AI OS (intended) | ~20+ | ~1,400+ | ⚠️ Mixed | Framework generic; examples and trials are stageverify-biased |
| `~/.cursor/skills-cursor/` | Generic Cursor skills | 15 | — | ✅ Clean | No stageverify contamination |

**Rule files (stageverify `.cursor/rules/`):**

| File | Purpose | Health |
|------|---------|--------|
| `ship-loop.mdc` | Commit → push → deploy sequence | ✅ Clean |
| `session-cleanup-gate.mdc` | Dev server / artifact cleanup | ✅ Clean |
| `model-dispatch-gate.mdc` | Pre-edit archetype + tier gate | ✅ Clean |
| `model-audit-gate.mdc` | Post-change model audit table | ✅ Clean |
| `agent-ops.mdc` | Bridge to global skill; Composer override | ⚠️ Overrides global §10 |
| `parallel-agent-strategy.mdc` | Scout fan-out defaults | ✅ New (f7d2c44) |
| `composer-orchestrator.mdc` | Session protocol + Playwright + ship + lessons | ⚠️ Overloaded hub |

---

## 3. Classification by Category

Memory assets classified into five buckets per the memory architecture framework.

### Bucket 1 — Truly Global (Portable AI OS)

Assets that should work unchanged across any repo:

| Asset | Location | Status |
|-------|----------|--------|
| Archetype slugs + seeds | `cursor-agent-brain/archetypes.json` | ✅ Generic |
| Tier table recompute script | `cursor-agent-brain/scripts/recompute-tier-table.js` | ✅ Generic |
| Nightly sync workflow | `cursor-agent-brain/.github/workflows/` | ✅ Generic |
| Outcome log schema | `cursor-agent-brain/outcomes/<hostname>.jsonl` | ✅ Generic (content is per-repo) |
| Generic playbooks (structure) | `cursor-agent-brain/playbooks/*.md` | ⚠️ Some Firebase-specific lessons |
| Cursor skills (canvas, SDK, etc.) | `~/.cursor/skills-cursor/` | ✅ Fully generic |
| Bootstrap PROJECT_STATUS stubs | `cursor-agent-brain/bootstrap/*.md` | ✅ `<REPO>` placeholders |

### Bucket 2 — Global Framework, Project-Contaminated Examples

Framework is reusable; examples must be decontaminated:

| Asset | Contamination | Fix (Phase 1) |
|-------|--------------|---------------|
| `cursor-agent-brain/SKILL.md` | Sonnet orchestrator default; "Dan-Away"; Firebase `ProtectedRoute`/`?next=` examples; `trials.json` path | Generic orchestrator pattern + placeholders |
| `cursor-agent-brain/README.md` | Wrong install path (`skills-cursor/` vs `skills/`); "Dan-Away" branding | Fix paths; rename to "Owner-Away" |
| `cursor-agent-brain/STATS.md` | Stale (shows 0; actual ~70+ rows) | Nightly recompute fix (Phase 2) |

### Bucket 3 — Project-Specific by Design (Stays in StageVerify)

| Asset | Why it stays |
|-------|-------------|
| All `.cursor/rules/*.mdc` | Procedural guardrails tuned to stageverify stack (Vite, Playwright, gh-pages, Firebase) |
| All `PROJECT_STATUS/*` | Hot-tier working memory for this product |
| `docs/project_state.md`, `docs/roadmap.md` | Phase truth and V2 vision for StageVerify |
| `docs/stageverify_v2_architecture.md` | Product architecture |
| Inline `src/` rationale comments | Domain-specific QR/routing/dispatcher logic |
| `cursor-agent-brain/trials.json` (current location) | 100% stageverify trial tasks — **must move to stageverify** |

### Bucket 4 — Mixed (Requires Separation)

| Asset | Global part | Project part | Action |
|-------|------------|-------------|--------|
| `agent-ops.mdc` | Outcome logging, tier table read | Composer override, Windows shell note, Firestore bias | Keep override explicit; add pointer to global default |
| `composer-orchestrator.mdc` | Session start protocol, build gate | Playwright routes, nav IA, June 2 lessons | **Do not split in Phase 1** — see §12 |
| `MODEL_DOSSIER.md` | Model routing tags (generic pattern) | QR, pickup, dispatcher lessons | Keep; archive § when >15 rows |

### Bucket 5 — Stale / Duplicate (Cleanup Candidates)

| Item | Status post-Phase-1 | Remaining action |
|------|--------------------|--------------------|
| Root `roadmap.md`, `PROJECT_PLAN.md` | ✅ Deleted | None |
| `roadmap-sync.mdc` | ✅ Deleted | None |
| `AGENT_OPS_PHASE2.md` | ✅ Archived | None |
| `security-report-2026-06-01.md` | ✅ Archived | None |
| Duplicate active blockers (4 files) | ⚠️ Partially fixed | Trim PHYSICAL_DEPLOYMENT blocker list |
| V2 vision in 6 files | ⚠️ Partially consolidated | Load `docs/project_state.md` only for phase decisions |
| `away-list.json` away-007 | ⚠️ May still be queued | Close if security audit done |
| Non-canonical outcome slugs | ⚠️ Open | Lint in Phase 2 |
| `composer-orchestrator.mdc` overload | ⚠️ Open | Defer split to Phase 2+ |

---

## 4. Proposed Portable AI OS Package Structure

Target layout for `cursor-agent-brain` after extraction:

```
C:\Projects\cursor-agent-brain\          # ~/.cursor/skills/agent-ops/
├── SKILL.md                             # Framework only — no project examples
├── README.md                            # Correct install paths
├── archetypes.json                      # Canonical slug list
├── scripts/
│   └── recompute-tier-table.js          # Deterministic tier table generator
├── .github/
│   └── workflows/
│       └── nightly-sync.yml             # Cron recompute + commit
├── outcomes/
│   └── <HOSTNAME>.jsonl                 # Per-machine, per-repo outcome logs
├── playbooks/
│   ├── backend-write-critical.md        # Generic security lessons
│   ├── multi-file-feature.md
│   ├── css-restyle.md
│   └── ...                              # One per archetype; ≤8 bullets each
├── bootstrap/
│   ├── PROJECT_STATUS/
│   │   ├── CURRENT_STATE.md.template
│   │   ├── MODEL_DOSSIER.md.template
│   │   ├── away-list.json.template
│   │   └── away-status.json.template
│   └── rules/
│       ├── ship-loop.mdc.template
│       ├── session-cleanup-gate.mdc.template
│       ├── model-dispatch-gate.mdc.template
│       ├── model-audit-gate.mdc.template
│       ├── agent-ops-bridge.mdc.template
│       └── parallel-agent-strategy.mdc.template
└── docs/
    └── orchestration-profiles.md        # Sonnet-default vs Composer-default patterns
```

**Per-project additions (not in global package):**

```
<project-repo>/
├── .cursor/
│   ├── rules/                           # Copied from bootstrap; filled with project specifics
│   └── trials.json                      # MOVED from cursor-agent-brain
├── PROJECT_STATUS/                      # Copied from bootstrap templates
└── docs/
    └── project_state.md                 # Project-specific phase truth
```

---

## 5. What Goes in the Package

| Component | Rationale |
|-----------|-----------|
| **SKILL.md (decontaminated)** | Universal session startup, tier table, away-list protocol, outcome logging, security gate *pattern* (not Firebase-specific checklist) |
| **archetypes.json** | Single source of truth for task classification slugs |
| **recompute-tier-table.js** | Deterministic learning loop — no AI cost |
| **playbooks/** | Failure-derived lessons by archetype; injected into subagent prompts |
| **bootstrap/PROJECT_STATUS/** | Templates with `<REPO>`, `<STACK>`, `<DEPLOY_URL>` placeholders |
| **bootstrap/rules/** | Generic rule templates — project fills stack-specific details |
| **orchestration-profiles.md** | Documents Sonnet-default (global) vs Composer-default (billing-optimized) patterns |
| **outcomes/** | Cross-project learning data — stays mixed by design |

**Orchestration policy in the package (proposed):**

- **Default profile:** Sonnet 4.6 orchestrates, delegates to tier-table models (original SKILL intent).
- **Composer profile:** Documented override pattern for repos that opt in (stageverify model).
- Per-repo `.cursor/rules/agent-ops.mdc` (or bridge template) declares which profile is active.

---

## 6. What Stays in StageVerify

| Asset | Reason |
|-------|--------|
| `.cursor/rules/composer-orchestrator.mdc` | Playwright CLI for stageverify routes, gh-pages deploy, Firebase rules deploy |
| `.cursor/rules/parallel-agent-strategy.mdc` | Composer orchestration + scout fan-out tuned to this project's cost model |
| `.cursor/trials.json` (target location) | Trial ladder with stageverify task names (`receiving-scan-feature`, etc.) |
| `PROJECT_STATUS/CURRENT_STATE.md` | Active blockers, immediate next step |
| `PROJECT_STATUS/MODEL_DOSSIER.md` | QR routing, pickup portal, dispatcher nav lessons |
| `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | Rejected nav/scope decisions |
| `docs/project_state.md` | Canonical phase truth |
| `docs/roadmap.md` | V2 NOW/NEXT/LATER |
| `docs/stageverify_v2_architecture.md` | Product architecture reference |
| All `scripts/verify-*.mjs` | Route-specific Playwright verification |
| `src/` inline rationale | Domain code documentation |

---

## 7. Templates

### Existing bootstrap templates (keep, minor updates)

| Template | Path | Placeholders |
|----------|------|-------------|
| CURRENT_STATE | `bootstrap/CURRENT_STATE.md` | `<REPO>`, `<fill in>` for phase/stack/blockers |
| MODEL_DOSSIER | `bootstrap/MODEL_DOSSIER.md` | `<REPO>`, local gotchas table |
| away-list | `bootstrap/away-list.json` | Empty `items: []` |
| away-status | `bootstrap/away-status.json` | `lastRun: null` |

### New bootstrap rule templates (Phase 1 deliverable)

| Template | Source (stageverify) | Generic substitutions |
|----------|---------------------|----------------------|
| `ship-loop.mdc.template` | `ship-loop.mdc` | `<DEPLOY_COMMAND>`, `<RULES_DEPLOY_COMMAND>` |
| `session-cleanup-gate.mdc.template` | `session-cleanup-gate.mdc` | `<DEV_PORT>`, `<VERIFY_ARTIFACT_GLOB>` |
| `model-dispatch-gate.mdc.template` | `model-dispatch-gate.mdc` | `<ORCHESTRATOR_MODEL>`, tier table reference |
| `model-audit-gate.mdc.template` | `model-audit-gate.mdc` | Unchanged — fully generic |
| `agent-ops-bridge.mdc.template` | `agent-ops.mdc` | `<ORCHESTRATION_PROFILE>`, `<BRAIN_REPO_PATH>` |
| `parallel-agent-strategy.mdc.template` | `parallel-agent-strategy.mdc` | `<ORCHESTRATOR_MODEL>`, scout boilerplate |

### New project fill-in checklist

1. Copy `bootstrap/PROJECT_STATUS/*` → `<repo>/PROJECT_STATUS/`
2. Copy `bootstrap/rules/*.template` → `<repo>/.cursor/rules/` (strip `.template` suffix)
3. Replace all `<REPO>`, `<STACK>`, `<DEPLOY_URL>`, `<ORCHESTRATOR_MODEL>` placeholders
4. Create empty `<repo>/.cursor/trials.json` from schema in SKILL.md §Phase 2b
5. Set orchestration profile in `agent-ops-bridge.mdc` (Sonnet or Composer)
6. Add first outcome row to `cursor-agent-brain/outcomes/<hostname>.jsonl`

---

## 8. Lessons to Generalize vs Must Stay Project-Specific

### Generalize (move to playbooks or SKILL patterns)

| Lesson | Current location | Generalized form |
|--------|-----------------|------------------|
| Security gate two-step (scan + verify) | SKILL.md §11 | Generic: scanner checklist without Firebase terms |
| Trial ladder for `backend-write-critical` | SKILL.md §Phase 2b | Schema + protocol; trials.json per project |
| Parallel scout fan-out for read-only work | `parallel-agent-strategy.mdc` | Template with `<ORCHESTRATOR_MODEL>` |
| Pre-edit archetype gate | `model-dispatch-gate.mdc` | Fully portable |
| Session cleanup (stop dev servers, delete PNGs) | `session-cleanup-gate.mdc` | Template with port/artifact placeholders |
| CURRENT_STATE ≤55 line cap | bootstrap template | Universal hot-tier discipline |
| Playwright before/after for UI changes | `composer-orchestrator.mdc` | Generic verify loop; route scripts stay local |
| Away-list triage criteria | SKILL.md §4 | Rename "Dan-Away" → "Owner-Away" |
| Outcome logging schema | SKILL.md §8 | Already generic |
| "Announce-and-go" pre-edit gate | `model-dispatch-gate.mdc` | Portable; Sonnet SKILL had "wait for proceed" — reconcile |

### Must stay project-specific

| Lesson | Location | Why |
|--------|----------|-----|
| Pickup portal hash routing | `MODEL_DOSSIER.md` § agent-lessons | StageVerify URL/hash semantics |
| `applyHashFromScannedQr` symptom trace | `MODEL_DOSSIER.md` § qr-routing | Domain QR behavior |
| Dispatcher nav IA freeze | `USER_SCOPE_REJECTIONS.md` | Rejected Settings merge, sidebar items |
| `verify:pickup` Playwright script | `scripts/verify-pickup-portal.mjs` | StageVerify routes and DOM |
| Firebase project `stageverify-db` | `docs/project_state.md` | Infrastructure binding |
| ESL / Minew integration plan | `ESL_INTEGRATION_PLAN.md` | Hardware vendor specifics |
| Composer trial task names | `trials.json` | `receiving-scan-feature`, etc. |
| Windows `cmd /c dir` shell note | `agent-ops.mdc` | Dan's machine-specific terminal capture |
| gh-pages deploy URL | `ship-loop.mdc` | `lgarage.github.io/stageverify` |

---

## 9. New Project Bootstrap Flow

Step-by-step for seeding a new repo from the portable AI OS (target: one session to first shipped feature).

```
┌─────────────────────────────────────────────────────────────┐
│ 1. INSTALL GLOBAL OS                                        │
│    git clone cursor-agent-brain → ~/.cursor/skills/agent-ops│
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CREATE PROJECT REPO                                      │
│    Initialize git, stack (e.g. Vite + React), package.json  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. COPY BOOTSTRAP TEMPLATES                                 │
│    bootstrap/PROJECT_STATUS/* → PROJECT_STATUS/             │
│    bootstrap/rules/*.template → .cursor/rules/              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FILL PLACEHOLDERS                                        │
│    <REPO>, <STACK>, <DEPLOY_URL>, <ORCHESTRATOR_MODEL>      │
│    Choose profile: Sonnet-default OR Composer-default       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. CREATE PROJECT STATE                                     │
│    docs/project_state.md — phase truth (manual or agent)    │
│    .cursor/trials.json — empty ladder if backend expected   │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. FIRST SESSION                                            │
│    Agent reads CURRENT_STATE.md + tier table + rules        │
│    Zero knowledge of stageverify required                   │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. SHIP LOOP                                                │
│    build → verify → commit → push → deploy → outcome log    │
└─────────────────────────────────────────────────────────────┘
```

**Acceptance test:** A fresh agent session on a new repo should never load stageverify-specific files, never reference `MODEL_DOSSIER.md` QR sections, and never read `cursor-agent-brain/trials.json` for routing decisions (trials are per-project).

---

## 10. Future Lesson Routing Protocol

How lessons should flow between project memory and the global OS after extraction.

### Lesson capture (end of failed or reworked task)

1. **Classify** — which archetype slug (`archetypes.json`)?
2. **Generalize test** — could this lesson apply to any repo?
   - **Yes** → append to `cursor-agent-brain/playbooks/<archetype>.md` (≤8 bullets; drop weakest on overflow)
   - **No** → append to `PROJECT_STATUS/MODEL_DOSSIER.md` § gotchas or `USER_SCOPE_REJECTIONS.md`
3. **Delegate write** — shell subagent commits to correct repo (brain vs project)
4. **Log outcome** — one row in `outcomes/<hostname>.jsonl`

### Lesson injection (start of task)

| Trigger | Load from |
|---------|-----------|
| Any task | Global tier table (SKILL.md §2) |
| Archetype X task | `playbooks/<X>.md` if bullets exist (SKILL.md §Phase 2a) |
| Domain-specific task | `MODEL_DOSSIER.md` § matching tag only |
| UI/nav scope | `USER_SCOPE_REJECTIONS.md` |
| Phase/roadmap decision | `docs/project_state.md` |

### Anti-patterns (do not do)

- Do not copy stageverify Playwright commands into global SKILL
- Do not put product feature names in `playbooks/`
- Do not grow `CURRENT_STATE.md` with session logs — archive immediately
- Do not log outcomes with non-canonical slugs (`frontend-feature` → use `multi-file-feature`)

### Routing decision tree

```
New lesson learned
       │
       ▼
  Applies to any repo?
    /        \
  Yes         No
   │           │
   ▼           ▼
playbooks/   MODEL_DOSSIER.md
(archetype)  or USER_SCOPE_REJECTIONS.md
```

---

## 11. Duplicate/Stale Cleanup Opportunities

Post-Phase-1 remaining cleanup (no code changes required).

| ID | Item | Effort | ROI | Status |
|----|------|--------|-----|--------|
| D1 | Trim duplicate blockers from `PHYSICAL_DEPLOYMENT.md` | S | HIGH | Open |
| D2 | Close `away-list.json` away-007 if security audit done | S | MED | Open |
| D3 | Update `away-status.json` lastRun timestamp discipline | S | MED | Open |
| D4 | Fix `cursor-agent-brain/README.md` install path | S | HIGH | Phase 1 |
| D5 | Canonicalize outcome archetype slugs in existing jsonl | S | MED | Phase 2 |
| D6 | Fix stale `STATS.md` / nightly recompute | M | MED | Phase 2 |
| D7 | Archive `MODEL_DOSSIER.md` § when >15 active rows | S | MED | Ongoing |
| D8 | Remove Firebase-specific bullets from `playbooks/security-review.md` | S | HIGH | Phase 1 |
| D9 | `composer-orchestrator.mdc` split (procedure / lessons / nav) | M | HIGH | **Defer** — see §12 |
| D10 | Encoding cleanup in any remaining mojibake files | S | LOW | Mostly done |

**Completed in Phase 1 memory cleanup (711b16f):**

- Deleted `roadmap-sync.mdc`
- Archived `AGENT_OPS_PHASE2.md`, `security-report-2026-06-01.md`
- Deleted root `roadmap.md`, `PROJECT_PLAN.md`
- Archived orphaned typography scripts
- Promoted `docs/project_state.md`

---

## 12. ROI-Ranked Next Steps

Prioritized roadmap for portable AI OS maturity.

| Rank | Step | Phase | Effort | Impact | Risk |
|------|------|-------|--------|--------|------|
| 1 | Reconcile SKILL §10 Sonnet orchestrator with Composer override pattern | **Phase 1** | M | Eliminates #1 agent confusion | LOW |
| 2 | Move `trials.json` → `stageverify/.cursor/trials.json` | **Phase 1** | S | Separates project trial state | LOW |
| 3 | Decontaminate SKILL.md (Firebase examples, "Dan-Away", personal refs) | **Phase 1** | M | Makes OS truly portable | MED |
| 4 | Add `bootstrap/rules/*.template.mdc` set | **Phase 1** | M | Enables new project seeding | LOW |
| 5 | Fix README install path + add `orchestration-profiles.md` | **Phase 1** | S | Onboarding clarity | LOW |
| 6 | Generalize `playbooks/security-review.md` checklist | **Phase 1** | S | Portable security gate | LOW |
| 7 | Split `composer-orchestrator.mdc` into 3 files | Phase 2 | M | Reduces hub drift risk | MED |
| 8 | Add CURRENT_STATE line-count gate to ship-loop | Phase 2 | S | Enforces ≤55 cap automatically | LOW |
| 9 | Outcome slug lint + STATS.md fix | Phase 2 | S | Correct tier table weights | MED |
| 10 | Bootstrap second project (acceptance test) | Phase 3 | L | Validates portability | LOW |

### composer-orchestrator.mdc split — defer to Phase 2

**Recommendation: Do NOT split in Phase 1.**

| Factor | Assessment |
|--------|------------|
| Current stability | Phase 1 cleanup just settled; split risks breaking procedural chain |
| Cross-references | `parallel-agent-strategy.mdc`, `ship-loop.mdc`, `agent-ops.mdc` all reference orchestrator |
| Benefit | High long-term, but only after global/project separation is clean |
| Prerequisite | Extraction Phase 1 complete + 2 weeks stable sessions |

**When to split (Phase 2 criteria):**

- `composer-orchestrator.mdc` exceeds 250 lines again
- Episodic lessons (June 2 pickup) cause repeated agent confusion
- A second project is bootstrapped and needs only the generic subset

**Proposed split (Phase 2):**

1. `composer-orchestrator.mdc` — session protocol, build gate, ship reference (~60 lines)
2. `composer-playwright.mdc` — Playwright CLI, auth state, verify scripts (~80 lines)
3. `composer-lessons.mdc` — episodic lessons, nav freeze pointers (~50 lines)

---

## Appendix A — Orchestration Conflict Detail

The dual-policy problem is the highest-priority portability blocker.

| Policy source | Orchestrator | Default worker | Gate behavior |
|--------------|-------------|----------------|---------------|
| `cursor-agent-brain/SKILL.md` §10 | Sonnet 4.6 | Delegates all edits to subagents | Interactive gate: wait for proceed |
| `stageverify/agent-ops.mdc` | Composer 2.5 Fast | Inline for T0–T2 | Announce-and-go |
| `stageverify/parallel-agent-strategy.mdc` | Composer 2.5 Fast | Scouts parallel; one executor | Synthesis before edits |
| `stageverify/model-dispatch-gate.mdc` | Composer 2.5 Fast | Inline default | Announce-and-go |

**Resolution pattern (Phase 1):**

1. SKILL.md declares **default** = Sonnet orchestrator (for repos without override).
2. SKILL.md adds **§ Orchestration Profiles** documenting Composer override.
3. `bootstrap/rules/agent-ops-bridge.mdc.template` sets `<ORCHESTRATION_PROFILE>` explicitly.
4. stageverify keeps its override in `agent-ops.mdc` — no change to behavior, only clarity that it is an intentional profile.

---

## Appendix B — Task-Type Confidence Log

| Task Type | Model | Confidence | Notes |
|-----------|-------|------------|-------|
| `docs-update` (portability report) | Composer 2.5 Fast | 95% | Synthesis from PROJECT_STATUS/archives/MEMORY_ARCHITECTURE_ASSESSMENT.md + rules audit |
| `docs-update` (extraction plan) | Composer 2.5 Fast | 92% | Depends on brain repo access for exact paths |
| `backend-write-critical` extraction | Composer 2.5 Fast | N/A | Not in scope — docs only |

---

*Companion document: [`ai-os-extraction-phase-1-plan.md`](./ai-os-extraction-phase-1-plan.md)*
