# AECS Phase 2 Plan — Structural Reorganization (Planning Only)

> **Status:** PLANNING ONLY — no implementation until Dan approves  
> **Generated:** 2026-06-05  
> **Authority:** Meta/planning — not live agent guidance. Active orchestration remains `.cursor/rules/` + `agent-ops` skill until Phase 2 executes.  
> **Inputs:** [`docs/aecs-phase1-audit.md`](../aecs-phase1-audit.md), [`docs/ai-os-extraction-phase-1-plan.md`](../ai-os-extraction-phase-1-plan.md), user binding decisions (2026-06-05)  
> **Companion:** [`docs/aecs-phase1-audit.md`](../aecs-phase1-audit.md) (Phase 1 audit)

---

## Step 0 — cursor-agent-brain Relationship (mandatory before any migration)

### Is it a standalone external git repo?

**Yes.** `C:\Projects\cursor-agent-brain` is an independent git repository:

| Property | Value |
|----------|-------|
| Remote | `https://github.com/lgarage/cursor-agent-brain.git` |
| Role | Global learning loop, tier table, archetypes, outcome logs, bootstrap templates |
| Not a submodule | stageverify does not vendor or submodule the brain repo |

### How is it referenced from stageverify?

| Reference path | Purpose | Break risk if changed |
|----------------|---------|----------------------|
| `~/.cursor/skills/agent-ops` | **Runtime load path** — Cursor reads `SKILL.md` every session | Agents lose tier table, away-list protocol, outcome schema |
| `C:\Projects\cursor-agent-brain` | **Git source + outcome write path** in `agent-ops.mdc` PowerShell snippet | Session-end outcome logging fails; dual-push workflow breaks |
| `.cursor/rules/agent-ops.mdc` | Bridge declaring Composer profile; points to both paths above | Orchestration conflict unresolved; path refs stale |
| `cursor-agent-brain/trials.json` (via SKILL.md §Phase 2b) | Trial ladder state — **100% stageverify tasks, wrong repo** | Wrong trial routing for all projects loading SKILL |
| `cursor-agent-brain/outcomes/<COMPUTERNAME>.jsonl` | Cross-project learning data | Tier table recompute degrades; nightly sync no-ops |
| `cursor-agent-brain/archetypes.json` | Archetype slug validation for outcome rows | Invalid outcome rows rejected or misclassified |

**Install topology (verified on Dan's machine):** `~/.cursor/skills/agent-ops` resolves to the **same git toplevel** as `C:\Projects\cursor-agent-brain` (junction/symlink or direct clone). README incorrectly documents `~/.cursor/skills-cursor/agent-ops` — actual runtime path is `~/.cursor/skills/agent-ops`.

### What would break if paths change?

1. **Outcome logging** — hard-coded `Add-Content -Path "C:\Projects\cursor-agent-brain\outcomes\$m.jsonl"` in `agent-ops.mdc`; no env-var fallback today.
2. **Trial routing** — SKILL.md reads `cursor-agent-brain/trials.json`; moving trials without updating SKILL breaks `backend-write-critical` ladder.
3. **Skill discovery** — if `~/.cursor/skills/agent-ops` moves without reinstall, Cursor stops loading the global tier table.
4. **Nightly tier recompute** — GitHub Actions in brain repo; independent of stageverify but depends on outcome path stability.
5. **Bootstrap seeding** — new projects copy `cursor-agent-brain/bootstrap/*`; path change requires README + installer update.

**Phase 2 constraint:** Parameterize paths in **additive** manifest/bridge fields only; keep existing absolute paths working until Dan approves full parameterization (Phase 3 installer).

---

## Binding decisions (user-approved — non-negotiable for Phase 2)

| # | Decision | Phase 2 implication |
|---|----------|---------------------|
| 1 | Repo stays **stageverify** — not renamed to AECS | `aecs/` is a subsystem prefix inside this repo |
| 2 | Product stays at **repo root** | **Reject** `examples/stageverify/` and `targets/stageverify/` product relocation |
| 3 | Three layers: portable core / AECS dev memory / project memory | Directory layout maps explicitly to L1/L2/L3 |
| 4 | Extraction plan is **input**, reconciled with audit | Adopt/modify/defer/reject table below |
| 5 | Side-by-side install — not merge-into-`.cursor/rules/` as primary | Source in `aecs/core/`; runtime in `.cursor/rules/`; state in `.cursor/aecs/` |
| 6 | No stageverify repo rename; brain rename deferred | Brain stays separate git repo in Phase 2 |
| 7 | Security lens on every proposal | Checklist §12 |

---

## Phase 2 scope (narrow)

**Goal:** Introduce AECS directory structure, portable core source copies, orchestration authority resolution, and brain decontamination — **zero semantic change** to active `.cursor/rules/` behavior.

**In scope:**

- Create `aecs/` tree (core source + dev memory)
- Create `.cursor/aecs/` install-state area (manifest snapshot, ownership registry)
- Copy portable rule content to `aecs/core/rules/*.mdc.template` (from live files — snapshot only)
- Move `trials.json` brain → `stageverify/.cursor/trials.json`
- Brain repo: SKILL decontamination, orchestration profiles §, bootstrap templates
- Additive lines to `agent-ops.mdc` (profile declaration + trials path) — **no gate/ship semantics change**
- Archive superseded dual-authority docs to `aecs/dev/archives/` (read-only copies, not loaded by Cursor)

**Out of scope (Phase 3+):**

- Installer CLI (`aecs/installer/install.mjs`)
- `composer-orchestrator.mdc` split
- Syncing `aecs/core/` → `.cursor/rules/` automatically
- Brain repo merge into `aecs/`
- Repo rename (`cursor-agent-brain` → `ai-engineering-control-system`)
- Any `src/`, Firestore, deploy, or Playwright script changes

---

## Proposed directory structure (stageverify repo)

```
stageverify/                              # StageVerify product + AECS dev host (unchanged root)
├── aecs/                                 # Layer 1 source + Layer 2 dev memory (NOT Cursor-loaded)
│   ├── manifest.json                     # Core inventory: version, files, hashes, profile defaults
│   ├── core/                             # Layer 1 — portable, installable payload
│   │   ├── rules/                        # *.mdc.template (no product facts)
│   │   ├── schemas/                      # trials.json, away-list, outcome row JSON schemas
│   │   └── playbooks/                    # Generic playbook stubs (optional Phase 2)
│   ├── dev/                              # Layer 2 — AECS evolution (excluded from install payload)
│   │   ├── docs/                         # Architecture, UPGRADE notes, orchestration rationale
│   │   └── archives/                     # Superseded planning authority copies
│   └── adapters/                         # Integration adapter specs (not executables yet)
│       └── stageverify.bindings.json     # Maps L3 paths: deploy, verify scripts, memory tiers
├── .cursor/
│   ├── rules/                            # Layer 3 — ACTIVE runtime (unchanged load path)
│   ├── trials.json                       # Layer 3 — MOVED from brain (per-project trials)
│   └── aecs/                             # Side-by-side install STATE (new)
│       ├── installed-manifest.json       # Snapshot: version, profile, file hashes at install time
│       ├── ownership.json                # owned-by-core | owned-by-project | generated | local-override
│       └── backups/                      # Empty until Phase 3 updates; .gitkeep only in Phase 2
├── PROJECT_STATUS/                       # Layer 3 — unchanged
├── docs/                                 # Layer 3 product + Layer 2 AECS planning
│   ├── aecs-phase1-audit.md
│   └── aecs/phase-2-plan.md              # This document
└── src/                                  # Layer 3 product — untouched
```

**Rejected layout (from Phase 1 audit §5.1):** `targets/stageverify/` — violates binding decision #2 (product relocation). StageVerify bindings live in `aecs/adapters/stageverify.bindings.json` as pointers, not a relocated product tree.

**External (unchanged):**

```
cursor-agent-brain/                       # Separate git — global skill + learning loop
├── SKILL.md                              # Decontaminated; orchestration profiles §
├── outcomes/<machine>.jsonl
├── archetypes.json
└── bootstrap/                            # Mirrors aecs/core templates for skill-only installs
```

---

## Side-by-side install area design (evidence-based decision)

| Candidate | Verdict | Rationale |
|-----------|---------|-----------|
| Merge portable core into `.cursor/rules/` as primary | **Reject** | Cursor loads `.cursor/rules/` directly; treating it as source-of-truth prevents separation, update diff, and override preservation |
| `aecs/install/` as runtime target | **Reject for runtime** | Cursor does not load `aecs/`; moving rules there breaks sessions without a copy step |
| **`aecs/core/` as source + `.cursor/rules/` as runtime + `.cursor/aecs/` as state** | **Adopt** | Three-way separation: portable source, active rules, install metadata/backups |

**Ownership model:**

| Zone | Owner | Survives core update? |
|------|-------|----------------------|
| `aecs/core/**` | AECS (Layer 1) | N/A — source |
| `aecs/dev/**` | AECS (Layer 2) | N/A — not installed |
| `.cursor/rules/*.mdc` | Project (Layer 3) | Project files preserved; core templates never overwrite without Phase 3 merge |
| `.cursor/aecs/installed-manifest.json` | Generated | Regenerated on install/update |
| `.cursor/aecs/ownership.json` | Generated + manual overrides flagged | Local overrides marked `local-override: true` |

**Agent edit rule (non-negotiable):** `.cursor/aecs/*` is **generated install state** — not a second source of truth. Agents MUST edit `aecs/core/` (or project-owned `.cursor/rules/` overrides) first; regenerate install snapshots via Phase 3 installer. Silent edits to `.cursor/aecs/` while `aecs/core/` is stale are forbidden.

**Traceability:** Every file in `.cursor/aecs/` maps to a canonical path in `aecs/manifest.json` via `installed-manifest.json` + `ownership.json` (`owned-by-core` | `owned-by-project` | `generated` | `local-override`).

**External brain:** `cursor-agent-brain/` remains a separate git repo. Phase 2 decontaminates SKILL.md and mirrors `aecs/core/` templates into `bootstrap/` — brain bootstrap is **downstream**, never authoritative over `aecs/core/`.

**StageVerify overrides:** Live rules in `.cursor/rules/`, `PROJECT_STATUS/`, and `aecs/adapters/stageverify.bindings.json` are Layer 3 — separate from portable AECS core.

---

## `aecs/manifest.json` proposal (schema v0.1.0)

```json
{
  "aecsVersion": "0.1.0",
  "profileDefault": "sonnet-default",
  "targetProfile": "composer-default",
  "layers": {
    "core": "aecs/core/",
    "dev": "aecs/dev/",
    "project": ".cursor/rules/"
  },
  "installState": ".cursor/aecs/",
  "brainRepo": {
    "skillPath": "~/.cursor/skills/agent-ops",
    "gitSourceEnv": "AECS_BRAIN_REPO_PATH",
    "gitSourceDefault": "C:/Projects/cursor-agent-brain"
  },
  "files": [
    {
      "path": "aecs/core/rules/model-audit-gate.mdc.template",
      "layer": 1,
      "sha256": "<computed-at-implementation>",
      "installedAs": null,
      "behaviorImpact": "none"
    }
  ],
  "projectOwned": [
    ".cursor/rules/composer-orchestrator.mdc",
    ".cursor/rules/ship-loop.mdc",
    ".cursor/rules/agent-ops.mdc",
    ".cursor/trials.json",
    "PROJECT_STATUS/**",
    "scripts/verify-*.mjs"
  ],
  "excludedFromInstall": [
    "aecs/dev/**",
    "src/**",
    "functions/**"
  ]
}
```

Phase 2 creates manifest with SHA placeholders during scaffolding; **Step 11 requires computed SHA-256 before any commit** (Sonnet M3 gate). Empty `<computed-at-implementation>` values block Phase 2 completion.

**Canonical template source (Sonnet M2):** `aecs/core/rules/` is authoritative for AECS development. `cursor-agent-brain/bootstrap/rules/` is a **downstream mirror** for skill-only installs — updated in the same session, same content, brain second.

---

## Integration adapters vs project overrides

| Concept | Location | Phase 2 action |
|---------|----------|----------------|
| **Portable core template** | `aecs/core/rules/*.mdc.template` | Create as copy of generic portions |
| **Integration adapter** | `aecs/adapters/stageverify.bindings.json` | Create — declarative bindings only |
| **Project override (live)** | `.cursor/rules/*.mdc` | **No semantic edits** except additive profile line in `agent-ops.mdc` |
| **Bridge to global skill** | `agent-ops.mdc` | Add `orchestrationProfile: composer-default` block |

**`stageverify.bindings.json` (adapter) — bindings only, no code:**

```json
{
  "targetName": "stageverify",
  "orchestrationProfile": "composer-default",
  "memory": {
    "hot": "PROJECT_STATUS/CURRENT_STATE.md",
    "warm": "PROJECT_STATUS/MODEL_DOSSIER.md",
    "phase": "docs/project_state.md",
    "roadmap": "docs/roadmap.md"
  },
  "ship": {
    "deploy": "npm run deploy",
    "rulesDeploy": "firebase deploy --only firestore:rules --project stageverify-db"
  },
  "verify": {
    "pickup": "npm run verify:pickup",
    "devPort": 5173
  },
  "trials": ".cursor/trials.json"
}
```

Adapters document integration; they do **not** replace live rules in Phase 2.

---

## Brain extraction reconciliation

Reconciles [`docs/ai-os-extraction-phase-1-plan.md`](../ai-os-extraction-phase-1-plan.md) with audit and binding decisions.

| Extraction item | Verdict | Phase 2 action |
|-----------------|---------|----------------|
| Orchestration profiles in SKILL.md | **Adopt** | Add § Orchestration Profiles; Profile B exception notes |
| Move `trials.json` to stageverify | **Adopt** | Copy → verify refs → delete brain copy |
| SKILL decontamination (Dan-Away, Firebase examples) | **Adopt** | Apply §8 snippets from extraction plan |
| Bootstrap `rules/*.template` in brain | **Adopt** | Create in brain; **mirror** copies in `aecs/core/rules/` |
| Bootstrap PROJECT_STATUS `*.template` rename | **Adopt** | Brain only |
| `docs/orchestration-profiles.md` in brain | **Adopt** | Create; cross-link from `aecs/dev/docs/` |
| `agent-ops.mdc` profile declaration | **Adopt (additive)** | 3–5 lines; no behavior change |
| `composer-orchestrator` split-deferred note | **Adopt** | One header line |
| `composer-orchestrator` 3-file split | **Defer** | Phase 3+ after profiles stable |
| Path parameterization (`<BRAIN_REPO_PATH>`) | **Modify** | Manifest documents env var; **keep** hard-coded path working in Phase 2 |
| `examples/stageverify/` layout | **Reject** | Binding decision #2 |
| `targets/stageverify/` overlay tree | **Reject** | Use `aecs/adapters/stageverify.bindings.json` instead |
| Brain merge into `aecs/` monorepo | **Defer** | Binding decision #6 |
| Installer CLI | **Defer** | Phase 3 gate |
| Outcome `.jsonl` history rewrite | **Reject** | Historical rows immutable |
| STATS.md stale fix | **Defer** | Phase 3 |

---

## Single orchestration authority resolution plan

**Problem:** SKILL.md §10 (Sonnet orchestrator, wait-for-proceed) conflicts with `agent-ops.mdc` (Composer orchestrator, announce-and-go).

**Resolution (no behavior change for StageVerify):**

```
1. SKILL.md gains § Orchestration Profiles (Sonnet-default | Composer-default)
   └── States: "Project .cursor/rules/ bridge is authoritative when profiles conflict"

2. agent-ops.mdc gains explicit block:
   └── orchestrationProfile: composer-default
   └── trials path: .cursor/trials.json

3. composer-orchestrator.mdc, parallel-agent-strategy.mdc, model-dispatch-gate.mdc
   └── UNCHANGED semantics (already align with Composer profile)

4. Superseded authority copies archived to aecs/dev/archives/
   └── portable-ai-os-report.md snapshot (if dual-authority wording)
   └── NOT deleted from docs/ — archive is additive copy for audit trail

5. Live authority chain after Phase 2:
   Cursor system → user rules → .cursor/rules/* (collective)
   → agent-ops.mdc declares composer-default (wins over SKILL §10)
   → SKILL.md tier table + outcome schema (subordinate on orchestration, authoritative on schema)
```

**Achievability:** Yes — extraction plan §8 snippets are sufficient; StageVerify behavior unchanged because profile stays `composer-default`.

---

## Implementation sequence (when approved)

> **Order constraint (Sonnet H1):** Brain SKILL.md MUST be updated (Steps 6–7) **before** `agent-ops.mdc` broadcasts the new trials path (Step 9). Copy `trials.json` to stageverify (Step 5) is safe while SKILL still points at brain — no agent reads `.cursor/trials.json` until refs exist.

| Step | Action | Repo | Rollback |
|------|--------|------|----------|
| 0 | Tag `pre-aecs-phase2` | both | `git reset --hard pre-aecs-phase2` |
| 1 | Create `aecs/` tree + `manifest.json` (v0.1.0) | stageverify | Delete `aecs/` |
| 2 | Copy portable rules → `aecs/core/rules/*.template` | stageverify | Delete copies |
| 3 | Create `.cursor/aecs/` + `ownership.json` + `installed-manifest.json` stub | stageverify | Delete `.cursor/aecs/` |
| 4 | Create `aecs/adapters/stageverify.bindings.json` | stageverify | Delete file |
| 5 | Copy `trials.json` → `.cursor/trials.json` (do not delete brain copy yet) | stageverify | Remove file |
| 6 | Brain: orchestration profiles doc + SKILL decontamination (trials path → `<project>/.cursor/trials.json`) | brain | `git checkout` brain |
| 7 | Brain: bootstrap templates; **then** delete `trials.json` from brain | brain | Restore from tag |
| 8 | **Checkpoint:** grep brain for `cursor-agent-brain/trials.json` → zero matches | brain | — |
| 9 | Update `agent-ops.mdc` (profile + trials path) — exact text below | stageverify | `git checkout` file |
| 10 | Add split-deferred note to `composer-orchestrator.mdc` | stageverify | Revert one line |
| 11 | Mirror bootstrap rules in `aecs/core/rules/`; compute SHA-256 into `manifest.json` | stageverify | Delete duplicates |
| 12 | Archive superseded authority note to `aecs/dev/archives/` | stageverify | Delete archive |
| 13 | Validation gate (§11) — **block commit if manifest hashes empty** | both | — |
| 14 | Two commits (brain first, stageverify second) | both | Per-step rollback |

### Exact additive block for `agent-ops.mdc` (Sonnet M4)

Insert after the opening paragraph (before Session start):

```markdown
## Orchestration profile
- **Profile:** `composer-default` (explicit opt-in; overrides SKILL.md §10 Sonnet-default)
- **Trials:** `.cursor/trials.json` (per-project; NOT `cursor-agent-brain/trials.json`)
- **Authority:** This file wins over SKILL.md on orchestration; SKILL.md wins on outcome schema and tier table.
```

No other lines in `agent-ops.mdc` change in Phase 2.

**Explicit non-actions:** No edits to `ship-loop.mdc`, `parallel-agent-strategy.mdc`, `model-dispatch-gate.mdc`, `session-cleanup-gate.mdc`, `model-audit-gate.mdc` content (except cross-ref if trials path mentioned). No `npm run deploy`. No build required (docs + rules metadata only).

---

## Exact intended file changes

| Path | Action | Layer | Behavior impact |
|------|--------|-------|-----------------|
| `aecs/manifest.json` | create | 1 | none |
| `aecs/core/rules/model-audit-gate.mdc.template` | copy | 1 | none |
| `aecs/core/rules/model-dispatch-gate.mdc.template` | copy | 1 | none |
| `aecs/core/rules/parallel-agent-strategy.mdc.template` | copy | 1 | none |
| `aecs/core/rules/session-cleanup-gate.mdc.template` | copy | 1 | none |
| `aecs/core/rules/agent-ops-bridge.mdc.template` | copy | 1 | none |
| `aecs/core/rules/ship-loop.mdc.template` | copy | 1 | none |
| `aecs/core/schemas/trials.schema.json` | create | 1 | none |
| `aecs/core/schemas/outcome-row.schema.json` | create | 1 | none |
| `aecs/adapters/stageverify.bindings.json` | create | 3 | none |
| `aecs/dev/docs/orchestration-rationale.md` | create | 2 | docs-only |
| `aecs/dev/archives/dual-authority-pre-profiles.md` | archive | 2 | docs-only |
| `.cursor/aecs/installed-manifest.json` | create | 3 | none |
| `.cursor/aecs/ownership.json` | create | 3 | none |
| `.cursor/aecs/backups/.gitkeep` | create | 3 | none |
| `.cursor/trials.json` | copy (from brain) | 3 | none (path only) |
| `.cursor/rules/agent-ops.mdc` | edit (additive) | 3 | none — profile declaration |
| `.cursor/rules/composer-orchestrator.mdc` | edit (1 line) | 3 | none |
| `docs/aecs/phase-2-plan.md` | create/edit | 2 | docs-only |
| `docs/aecs-phase1-audit.md` | edit (1-line cross-link) | 2 | docs-only |
| `PROJECT_STATUS/CURRENT_STATE.md` | edit (optional 1-line ref) | 3 | docs-only |
| `C:\Projects\cursor-agent-brain\SKILL.md` | edit | 1 (ext) | none for stageverify sessions |
| `C:\Projects\cursor-agent-brain\docs\orchestration-profiles.md` | create | 1 (ext) | docs-only |
| `C:\Projects\cursor-agent-brain\bootstrap/rules/*.template` | create | 1 (ext) | none |
| `C:\Projects\cursor-agent-brain\bootstrap/PROJECT_STATUS/*.template` | rename | 1 (ext) | none |
| `C:\Projects\cursor-agent-brain\trials.json` | archive/delete | — | none after stageverify copy |
| `C:\Projects\cursor-agent-brain\README.md` | edit | 1 (ext) | docs-only |
| `C:\Projects\cursor-agent-brain\playbooks/security-review.md` | edit | 1 (ext) | none |

**Untouched:** `src/**`, `functions/**`, `firestore.rules`, `package.json`, `ship-loop.mdc` content, Playwright scripts, outcome `.jsonl` history.

---

## Compatibility risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cursor loads only `.cursor/rules/` — `aecs/core/` invisible to runtime | LOW | Expected; no runtime dependency in Phase 2 |
| `aecs/core/` and brain bootstrap drift | MED | Step 10 mirror sync; manifest hashes |
| Dual-repo commit ordering | MED | Brain second; tag both before start |
| `agent-ops.mdc` additive edit accidentally changes semantics | MED | Diff review; Sonnet gate; grep for gate verbs |
| trials.json move with stale SKILL path | HIGH | Update SKILL **before** brain delete |
| `~/.cursor/skills/agent-ops` vs `C:\Projects\cursor-agent-brain` drift | LOW | Same git toplevel today; document in manifest |

---

## Validation steps (post-implementation)

| Check | Expected |
|-------|----------|
| `Test-Path .cursor/trials.json` | True |
| `Test-Path C:\Projects\cursor-agent-brain\trials.json` | False |
| `rg "cursor-agent-brain/trials" .cursor/rules/` | No matches |
| `rg "composer-default" .cursor/rules/agent-ops.mdc` | Match |
| `rg -i "Dan-Away\|ProtectedRoute" C:\Projects\cursor-agent-brain\SKILL.md` | No matches |
| `npm run build` | Pass (no src changes; sanity check) |
| Agent session dry-run | Composer profile; CURRENT_STATE first; ship loop unchanged |
| `aecs/manifest.json` validates against schema | All core templates listed |

---

## Rollback strategy

1. **Per-repo:** `git reset --hard pre-aecs-phase2`
2. **trials.json:** Restore brain copy from tag; delete `.cursor/trials.json`
3. **aecs/ tree:** `git clean -fd aecs/ .cursor/aecs/`
4. **SKILL.md:** `git -C cursor-agent-brain checkout HEAD -- SKILL.md`
5. **No Firestore/deploy rollback needed** — Phase 2 does not touch backend

---

## Gates before Phase 3 (installer CLI)

- [ ] `aecs/manifest.json` lists all core templates with SHA-256 hashes
- [ ] Orchestration profiles live in brain SKILL.md + `docs/orchestration-profiles.md`
- [ ] `trials.json` in `.cursor/`; brain copy removed
- [ ] `.cursor/aecs/ownership.json` distinguishes core vs project files
- [ ] Zero unresolved `<PLACEHOLDER>` in templates intended for install
- [ ] Grep portable templates for `stageverify`, `stageverify-db`, `C:\Projects\` → zero
- [ ] Dry-copy test: manual copy one template to empty repo (paper exercise)
- [ ] Dan approves Phase 2 completion and Phase 3 scope

---

## Security review checklist (Phase 2 execution)

| ID | Category | Check | Phase 2 note |
|----|----------|-------|--------------|
| SEC-1 | Repo boundary | No installer writes outside project root | No installer in Phase 2 |
| SEC-2 | Path validation | Manifest paths relative; no `..` traversal | Enforce in manifest schema |
| SEC-3 | Secrets | Do not copy `.env*`, `playwright/.auth/` into `aecs/` | Excluded by design |
| SEC-4 | Prompt injection | Resolve dual orchestration authority | Profiles § + bridge |
| SEC-5 | Command execution | No new shell execution surfaces | Docs/templates only |
| SEC-6 | Self-modification | Core templates in `aecs/core/`; live rules need human approval to sync | Phase 3 installer |
| SEC-7 | Supply chain | No `curl \| bash`; brain changes tagged | Tag `pre-aecs-phase2` |
| SEC-8 | Backup/rollback | Tags + per-step rollback documented | § above |
| SEC-9 | Auditability | `ownership.json` + manifest version pin | Created in Phase 2 |
| SEC-10 | Privilege | Away-list `preApproved` unchanged | No away-list edits |
| SEC-11 | Partial failure | Dual-repo push order documented | Brain second |
| SEC-12 | Silent overwrite | `.cursor/aecs/` tracks installed hashes | Foundation for Phase 3 diff |

---

## Decisions still requiring Dan

| # | Decision | Why genuine | Lean |
|---|----------|-------------|------|
| 1 | **Phase 2 timing vs product Phase 2** (Material Readiness) | Competing NOW tracks | Parallel — AECS Phase 2 is docs/rules only, no src conflict |
| 2 | **Approve dual-repo execution** (brain + stageverify same session) | Two pushes, coordinated rollback | Yes — required for trials move |
| 3 | **Mirror templates in both `aecs/core/` and brain bootstrap** | Duplication vs single source | **Lean:** both — `aecs/` is AECS canonical; brain bootstrap for skill-only installs |
| 4 | **Phase 3 installer priority** | After manifest validates | Defer until gates pass |

**Not requiring Dan (evidence decides):** Profile stays `composer-default`; product at root; side-by-side `.cursor/aecs/`; brain stays separate; no `targets/` relocation.

---

## Sonnet structural + security review

> **Reviewer:** Sonnet 4.6 (`claude-4.6-sonnet-medium-thinking`) via Task subagent  
> **Scope:** This document only  
> **Date:** 2026-06-05

### Verdict

**PASS WITH NOTES** — Plan is implementable without behavior change. One HIGH finding resolved by step reorder; four MED findings mitigated in-plan; three LOW accepted/deferred.

### Ranked findings (original)

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| H1 | HIGH | TRIALS-WINDOW — agent-ops.mdc before SKILL update creates conflicting trial paths | **Resolved** — Steps 6–8 brain-first; agent-ops edit now Step 9 |
| M1 | MED | SKILL-GLOBAL-BLAST-RADIUS — brain edits affect all skill consumers | **Mitigated** — decontamination is additive profiles §; grep gate Step 8; no Sonnet-default behavior change |
| M2 | MED | TEMPLATE-DUAL-SOURCE — ambiguous canonical source | **Resolved** — `aecs/core/` canonical; brain bootstrap is downstream mirror |
| M3 | MED | MANIFEST-HASH-PLACEHOLDERS — empty hashes silently break integrity | **Resolved** — Step 13 blocks commit if hashes empty |
| M4 | MED | AGENT-OPS-ADDITIVE-CONTENT — unspecified wording risk | **Resolved** — exact additive block specified above |
| L1 | LOW | ABSOLUTE-PATH-IN-MANIFEST | **Accepted** — documented default; env var override in Phase 3 |
| L2 | LOW | BACKUPS-EMPTY scaffold | **Accepted** — `.gitkeep` labeled placeholder in ownership.json |
| L3 | LOW | DUAL-REPO-PARTIAL-FAILURE | **Mitigated** — brain commits first; stageverify only after Step 8 checkpoint |

### No-behavior-change assessment

**PASS** — gate/ship/model-routing semantics untouched; only additive metadata in `agent-ops.mdc` and one header line in `composer-orchestrator.mdc`.

### Single orchestration authority

**YES** — achievable once Steps 6–9 complete: SKILL profiles § + bridge declaration + explicit authority line.

---

## Related documents

- Phase 1 audit: [`docs/aecs-phase1-audit.md`](../aecs-phase1-audit.md)
- Brain extraction input: [`docs/ai-os-extraction-phase-1-plan.md`](../ai-os-extraction-phase-1-plan.md)
- Portability scan: [`docs/portable-ai-os-report.md`](../portable-ai-os-report.md)

---

*Planning complete when Sonnet review is appended and Dan approves implementation.*
