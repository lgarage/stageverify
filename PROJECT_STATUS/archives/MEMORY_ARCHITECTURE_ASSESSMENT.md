> **ARCHIVED — partially actioned 2026-06-05.** Point-in-time audit only; not current authority. **Authority chain:** `docs/roadmap.md` header → `docs/project_state.md` (phase truth) → `docs/roadmap.md` (gates) → `PROJECT_STATUS/CURRENT_STATE.md` (hot snapshot).

# Memory Architecture Assessment — stageverify
_Generated: 2026-06-04 | Analyst: Senior AI Systems Architect_

---

## 1. Executive Summary

**Dan's hypothesis:** "The info exists, it's just scattered."  
**Verdict: CONFIRMED — with an addendum.** The info does exist, but it is also duplicated, contradictory in places, and mixed with project-specific data that contaminates what should be a reusable AI OS.

**Top 5 findings:**

1. **Duplication is the #1 tax.** Active blockers appear in 4 files; V2 vision in 6 files; roadmap in 3 conflicting versions. Agents waste context tokens reconciling these.
2. **`composer-orchestrator.mdc` (~230 lines) carries too much.** It mixes procedural (Playwright CLI commands), semantic (nav IA), and episodic (June 2 lessons) memory into one file. When it drifts, everything drifts with it.
3. **The agent-ops brain repo is stageverify-specific in disguise.** `trials.json` and 99% of `outcomes/*.jsonl` reference stageverify. `STATS.md` shows 0 (stale). The "global" skill is actually a stageverify-tuned system.
4. **Stale files are silently wrong.** `AGENT_OPS_PHASE2.md` says "no backend yet" — false. `ESL_INTEGRATION_PLAN.md` has an unchecked checkbox for zones — shipped. `away-status.json` hasn't been updated since June 1.
5. **No single source of truth for phase/feature status.** At least 5 files claim to describe what's built: `CURRENT_STATE.md`, `docs/project_state.md`, `docs/roadmap.md`, root `roadmap.md`, `PROJECT_PLAN.md`. They conflict.

**Top 3 actions by ROI:**

| Rank | Action | Why |
|------|--------|-----|
| 1 | Promote `docs/project_state.md` as the single phase truth; delete/archive the conflicting files | Ends the 5-way reconciliation tax every session |
| 2 | Split `composer-orchestrator.mdc` into procedure + lessons + nav-freeze | Makes each piece findable and purgeable independently |
| 3 | Separate global agent-ops from stageverify-specific data in `cursor-agent-brain` | Unlocks reuse; lets trial data evolve without polluting the OS |

---

## 2. Current State Assessment

### File inventory by category

| Category | Files | Est. Lines | Health |
|----------|-------|-----------|--------|
| `.cursor/rules/` (project rules) | 7 | ~850 | ⚠️ Contradictions, duplication |
| `PROJECT_STATUS/` (hot-tier memory) | 13 | ~830 | ⚠️ Stale files, violated caps |
| `docs/` (semantic/vision) | 6 | ~1,403 | ❌ Severe duplication |
| Root docs (`roadmap.md`, `PROJECT_PLAN.md`) | 2 | ~182 | ⚠️ Conflicts with docs/ |
| `scripts/` (procedural) | 13 | ~1,677 | ✅ Mostly good; 3 orphaned scripts |
| `src/` key files with rationale | ~8 | ~1,278 | ✅ Inline rationale appropriate |
| `cursor-agent-brain/` (global skill) | ~20+ | ~1,200+ | ⚠️ Stale STATS; mixed global/project |
| `~/.cursor/skills-cursor/` | 15 | — | ✅ Fully generic, no issues |

**Overall health rating: 5/10**  
The project works. The memory system that guides agents is fragmented, partially stale, and creating unnecessary context load every session.

---

## 3. Memory Classification Inventory

| File | Primary Type | Secondary | Notes |
|------|-------------|-----------|-------|
| `PROJECT_STATUS/CURRENT_STATE.md` | Working | Episodic | Session log (lines 30–96) is episodic bleed; violates its own 55-line cap |
| `PROJECT_STATUS/MODEL_DOSSIER.md` | Semantic | Episodic | § agent-lessons = episodic; § qr-routing = semantic; well-structured |
| `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | Episodic | Procedural | Purely decisions/rejections — good single-purpose file |
| `PROJECT_STATUS/away-list.json` | Working | — | Stale: away-007 queued but report exists; needs triage |
| `PROJECT_STATUS/away-status.json` | Working | — | Last updated June 1; stale |
| `PROJECT_STATUS/AGENT_OPS_PHASE2.md` | Semantic | — | Outdated; "no backend" is false |
| `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` | Semantic | Procedural | Zones checkbox stale; hardware/schema is correct |
| `PROJECT_STATUS/PHYSICAL_DEPLOYMENT.md` | Procedural | Semantic | Good 12-step chain; blocker list duplicates CURRENT_STATE |
| `PROJECT_STATUS/security-report-2026-06-01.md` | Episodic | — | Superseded; archive candidate |
| `PROJECT_STATUS/security-report-2026-06-02.md` | Episodic | Semantic | Active: ongoing MED/LOW risks documented |
| `docs/project_state.md` | Semantic | Working | Cleanest phase truth (2026-06-04, untracked) |
| `docs/roadmap.md` | Semantic | — | V2 NOW/NEXT/LATER — canonical roadmap |
| `docs/stage_verify_principles.md` | Semantic | — | Mission/non-goals; rarely needs reading |
| `docs/stageverify_v2_architecture.md` | Semantic | — | Architectural rationale; 535 lines; stable reference |
| `docs/stageverify_implementation_plan.md` | Semantic | — | Stale header; duplicates docs/roadmap.md |
| `docs/v2_transition_report.md` | Episodic | Semantic | Executive summary; data model checklist still relevant |
| Root `roadmap.md` | Semantic | — | V1 What's Built — conflicts with docs/roadmap.md |
| Root `PROJECT_PLAN.md` | Semantic | — | MVP + 11-step workflow; partially superseded |
| `.cursor/rules/composer-orchestrator.mdc` | Procedural | Semantic + Episodic | Hub file; overloaded; mixed types |
| `.cursor/rules/model-dispatch-gate.mdc` | Procedural | — | Clean; single purpose |
| `.cursor/rules/model-audit-gate.mdc` | Procedural | — | Clean; single purpose |
| `.cursor/rules/ship-loop.mdc` | Procedural | — | Clean; single purpose |
| `.cursor/rules/session-cleanup-gate.mdc` | Procedural | — | Clean; single purpose |
| `.cursor/rules/agent-ops.mdc` | Procedural | — | Bridges global skill; mixed scope |
| `.cursor/rules/roadmap-sync.mdc` | Procedural | — | Missing `alwaysApply`; content duplicates orchestrator |
| `cursor-agent-brain/SKILL.md` | Procedural | Semantic | Global-intent but stageverify-biased examples |
| `cursor-agent-brain/trials.json` | Working | — | Stageverify-specific trial data in "global" repo |
| `cursor-agent-brain/outcomes/*.jsonl` | Episodic | — | 99% stageverify; non-canonical slugs |
| `src/receiveQrUrls.ts`, `scanRouting.ts` | Semantic | — | Inline rationale with MODEL_DOSSIER references — good pattern |

---

## 4. Global vs Project Memory Analysis

### What is truly global (portable AI OS)
- `~/.cursor/skills-cursor/` — all 15 skills; no stageverify references ✅
- `cursor-agent-brain/SKILL.md` — framework is generic; _examples_ are biased
- `cursor-agent-brain/archetypes.json` — slugs are generic ✅
- `cursor-agent-brain/scripts/recompute-tier-table.js` — generic ✅
- `cursor-agent-brain/bootstrap/*` — template stubs with `<REPO>` placeholders ✅

### What is stageverify-specific (should stay in this repo)
- All `.cursor/rules/` files — explicitly stageverify
- All `PROJECT_STATUS/` files
- `cursor-agent-brain/trials.json` — trial data names stageverify features
- `cursor-agent-brain/outcomes/*.jsonl` — 99% stageverify rows

### Currently mixed — should be separated

| Mixed File | Global Content | Project Content |
|------------|---------------|-----------------|
| `cursor-agent-brain/SKILL.md` | Framework, tier table logic, away-list protocol | "Dan-Away", `ProtectedRoute`/Firebase security examples, `?next=` redirect examples |
| `cursor-agent-brain/trials.json` | Trial ladder structure | `receiving-scan-feature`, `mobile-hub-page`, `firestore-security-rules` task names |
| `cursor-agent-brain/STATS.md` | Tier table format | Data is 100% stale (shows 0 outcomes; actual ~70) |
| `agent-ops.mdc` | Global skill bridge | Windows `cmd /c dir` note, Firestore bias |

### Specific contamination examples
- `SKILL.md` line ~230: `"report to Dan"` — personal, not reusable
- `SKILL.md` security gate examples: `ProtectedRoute`, Firestore, `?next=` — Firebase-specific
- `README` in brain repo: install path says `skills-cursor/agent-ops/`; actual install is `skills/agent-ops/` — wrong in the global asset

---

## 5. Problems and Risks

### Critical (block agent effectiveness)

**C1: Five conflicting phase/status sources**  
Files: `CURRENT_STATE.md`, `docs/project_state.md`, `docs/roadmap.md`, root `roadmap.md`, `PROJECT_PLAN.md`  
Risk: Agent reads wrong source; acts on stale phase truth.

**C2: `CURRENT_STATE.md` violates its own 55-line cap (96 lines)**  
The episodic session log has grown into the working memory file. Next session agents load 40+ lines of stale changelog.

**C3: Security gate timing contradiction**  
`model-dispatch-gate.mdc`: "after commit" vs `composer-orchestrator.mdc`: "fix before pushing"  
Risk: Agent commits a security flaw, then can't cleanly fix it.

### High (create consistent errors)

**H1: `AGENT_OPS_PHASE2.md` says "no backend yet" — factually false**  
Firestore, rules, Cloud Functions are live. An agent reading this file gets wrong architectural context.

**H2: `roadmap-sync.mdc` missing `alwaysApply: true`**  
Content that should auto-apply doesn't. Rule may be silently ignored every session.

**H3: `roadmap-sync.mdc` contradicts `composer-orchestrator.mdc`**  
Says "status-update subagent MUST include roadmap.md" vs orchestrator says "inline, no separate subagent."

**H4: `ESL_INTEGRATION_PLAN.md` Zone Management checkbox unchecked — zones are shipped**  
Any agent reading this thinks zones are pending work.

**H5: `away-list.json` away-007 QUEUED despite `security-report-2026-06-02.md` existing**  
Agent may re-run a security audit that already completed.

### Medium (waste context / create confusion)

**M1: Duplicate active blockers** in CURRENT_STATE.md, docs/project_state.md, PHYSICAL_DEPLOYMENT.md, ESL_INTEGRATION_PLAN.md

**M2: Duplicate V2 vision** across 6 files (docs/project_state.md, docs/roadmap.md, stageverify_v2_architecture.md, v2_transition_report.md, stageverify_implementation_plan.md, stage_verify_principles.md)

**M3: STATS.md shows 0 outcomes** — stale nightly recompute; tier table not reflecting 70+ actual logged rows

**M4: Non-canonical archetype slugs** in outcomes files (`frontend-feature`, `bug-fix` instead of archetypes.json slugs)

**M5: 3 orphaned scripts** (`verify-typography.mjs`, `measure-typography.mjs`, `inspect-visual.mjs`) not in `package.json`; reference an HVAC project URL — copy-paste residue

**M6: Encoding mojibake** in CURRENT_STATE.md (`â€"` for em dashes, `?` for arrows) — cosmetic but signals file is not clean

**M7: `package.json` duplicate key** `verify:dispatcher-nav` — second entry silently wins

### Low (knowledge decay risk)

**L1: `composer-orchestrator.mdc` is a single point of failure** — 230-line hub; if it drifts, everything drifts

**L2: Inline architectural rationale in `src/` files** (good pattern) but only 2 files do it; others lack `MODEL_DOSSIER.md` cross-references

---

## 6. Recommended Folder Structure

```
c:\Projects\stageverify\
├── .cursor\
│   └── rules\                        # Procedural memory (alwaysApply)
│       ├── ship-loop.mdc             # Keep as-is ✅
│       ├── session-cleanup-gate.mdc  # Keep as-is ✅
│       ├── model-dispatch-gate.mdc   # Keep as-is ✅
│       ├── model-audit-gate.mdc      # Keep as-is ✅
│       ├── agent-ops.mdc             # Keep; remove Windows-specific note → CURRENT_STATE
│       ├── composer-orchestrator.mdc # SPLIT (see §7)
│       └── [DELETE roadmap-sync.mdc] # Content already in ship-loop + orchestrator
│
├── PROJECT_STATUS\                   # Hot-tier working+semantic memory
│   ├── CURRENT_STATE.md              # ≤55 lines; strip session log to archives
│   ├── MODEL_DOSSIER.md              # Keep; archive § when > 15 rows
│   ├── USER_SCOPE_REJECTIONS.md      # Keep ≤8 rows
│   ├── away-list.json                # Triage: close away-007
│   ├── away-status.json              # Update lastRun after each session
│   ├── ESL_INTEGRATION_PLAN.md       # Fix Zone checkbox; keep hardware/schema
│   ├── PHYSICAL_DEPLOYMENT.md        # Keep; remove duplicate blocker list
│   ├── security-report-2026-06-02.md # Keep as active reference
│   └── archives\
│       ├── AGENT_OPS_PHASE2.md       # MOVE here (stale)
│       ├── security-report-2026-06-01.md  # MOVE here (superseded)
│       └── dossier-notes.md          # Already here ✅
│
├── docs\                             # Semantic memory (rarely changes)
│   ├── project_state.md              # PROMOTE to single phase truth
│   ├── roadmap.md                    # Canonical V2 roadmap (NOW/NEXT/LATER)
│   ├── stage_verify_principles.md    # Keep; rarely read
│   ├── stageverify_v2_architecture.md # Keep; architectural reference
│   └── archives\
│       ├── stageverify_implementation_plan.md  # MOVE (stale header, duplicates roadmap)
│       └── v2_transition_report.md   # MOVE (one-time exec summary; data model checklist only)
│
├── scripts\                          # Procedural memory (executable)
│   ├── [keep all 10 registered scripts]
│   └── archives\
│       ├── verify-typography.mjs     # MOVE (orphaned; HVAC reference)
│       ├── measure-typography.mjs    # MOVE
│       └── inspect-visual.mjs        # MOVE
│
├── [DELETE root roadmap.md]          # Superseded by docs/roadmap.md
└── [DELETE root PROJECT_PLAN.md]     # Superseded by docs/project_state.md
```

`[ROI: HIGH | Effort: S | Impact: consolidate/save-context]`

---

## 7. AI Operating System Design

### The portable AI OS (non-stageverify portion)

```
C:\Projects\cursor-agent-brain\    (= ~/.cursor/skills/agent-ops/)
├── SKILL.md                        # Framework only; strip personal/Firebase examples
├── archetypes.json                 # Generic slugs ✅ keep
├── scripts\recompute-tier-table.js # Generic ✅ keep
├── bootstrap\                      # Template stubs ✅ keep
│   ├── CURRENT_STATE.md.template
│   └── MODEL_DOSSIER.md.template
├── playbooks\                      # Generic lesson patterns (not project lessons)
│   └── backend-write-critical.md   # Generalize: remove `npm run build` specificity
├── outcomes\<HOSTNAME>.jsonl       # All projects log here; keep mixed
└── [MOVE] trials.json → stageverify\.cursor\trials.json   # Project-specific
```

### What stays project-specific (stageverify)
- All `.cursor/rules/` — by design
- All `PROJECT_STATUS/` — by design
- `src/` inline rationale comments — by design
- `cursor-agent-brain/trials.json` — move to this repo

### How to bootstrap a new project from the AI OS
1. Copy `bootstrap/CURRENT_STATE.md.template` → `PROJECT_STATUS/CURRENT_STATE.md`; fill `<REPO>`, `<STACK>`, `<DEPLOY_URL>`
2. Copy `bootstrap/MODEL_DOSSIER.md.template` → `PROJECT_STATUS/MODEL_DOSSIER.md`
3. Copy `.cursor/rules/` from stageverify; replace stageverify-specific references (Playwright scripts, nav IA)
4. Add to `outcomes/<HOSTNAME>.jsonl` as new project rows
5. `trials.json` starts empty or copies ladder structure with new project task names

`[ROI: MED | Effort: M | Impact: clarify/reuse]`

---

## 8. Agent Memory Loading Strategy

### Hot tier — ALWAYS load (every session start)

| File | Why | Size target |
|------|-----|------------|
| `PROJECT_STATUS/CURRENT_STATE.md` | Active blockers, stack snapshot, immediate next steps | ≤55 lines |
| `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` | Prevent re-shipping rejected nav | ≤25 lines |
| Applicable `.cursor/rules/` | Procedural guardrails (already auto-applied) | auto |

**Context budget: ~80–100 lines before user message.**

### Warm tier — load ONLY when task touches the domain

| Trigger | Load |
|---------|------|
| QR scanning, routing, deep links | `MODEL_DOSSIER.md` § qr-routing, § encode-qr |
| Dispatcher portal UI | `MODEL_DOSSIER.md` § agent-lessons; `src/dispatcherPortalNav.ts` |
| Firestore rules / auth / CF | `MODEL_DOSSIER.md` § backend-critical; `firestore.rules` |
| ESL / zones / physical | `ESL_INTEGRATION_PLAN.md`; `PHYSICAL_DEPLOYMENT.md` |
| Roadmap / phase decisions | `docs/project_state.md`; `docs/roadmap.md` |
| Architecture refactors | `docs/stageverify_v2_architecture.md` |

### Cold tier — retrieve only when referenced

| File | When to retrieve |
|------|-----------------|
| `PROJECT_STATUS/archives/*` | Explicit historical question |
| `security-report-2026-06-02.md` | Security audit task |
| `docs/stage_verify_principles.md` | Mission/non-goal question |
| `cursor-agent-brain/outcomes/*.jsonl` | Phase 2 readiness decision |

### Working memory — temporary, never persist

| Content | Lifetime |
|---------|----------|
| CURRENT_STATE.md session log entries | Current session only; archive after |
| Before/after Playwright screenshots | Delete after verify passes |
| `away-status.json` lastRun timestamp | Update each session end |

`[ROI: HIGH | Effort: S | Impact: save-context/clarify]`

---

## 9. Migration Plan

**Principle:** Lowest-risk changes first. No code changes. Each step is independently reversible.

| Step | Action | Risk | Value |
|------|--------|------|-------|
| 1 | Delete `roadmap-sync.mdc` (content covered by ship-loop + orchestrator) | None | Removes contradiction H3 |
| 2 | Move `AGENT_OPS_PHASE2.md` to `PROJECT_STATUS/archives/` | None | Removes false "no backend" |
| 3 | Move `security-report-2026-06-01.md` to `PROJECT_STATUS/archives/` | None | Declutters hot tier |
| 4 | Add `alwaysApply: true` to any rule file missing it (verify roadmap-sync is gone) | None | N/A after step 1 |
| 5 | Fix ESL_INTEGRATION_PLAN.md Zone checkbox to checked | None | Removes false pending state |
| 6 | Close `away-list.json` away-007 (security audit done) | None | Removes stale queue item |
| 7 | Trim `CURRENT_STATE.md` session log to last 2 entries; archive the rest | Low | Restores ≤55 line cap |
| 8 | Add `docs/archives/` folder; move `stageverify_implementation_plan.md` there | Low | Removes duplicate roadmap |
| 9 | Delete root `roadmap.md` and `PROJECT_PLAN.md` (add redirect comment in CURRENT_STATE) | Low | Ends 5-way reconciliation |
| 10 | Move `verify-typography.mjs`, `measure-typography.mjs`, `inspect-visual.mjs` to `scripts/archives/` | None | Removes orphaned/misleading scripts |
| 11 | Fix `package.json` duplicate `verify:dispatcher-nav` key | Low | Prevents silent overwrite |
| 12 | Fix CURRENT_STATE.md encoding (`â€"` → `—`) | None | Cosmetic cleanup |
| 13 | Move `cursor-agent-brain/trials.json` to `.cursor/trials.json`; update SKILL.md reference | Med | Separates global from project |
| 14 | Strip personal/Firebase bias from `cursor-agent-brain/SKILL.md` examples | Med | Makes AI OS portable |

**Do NOT change yet:** `composer-orchestrator.mdc` split (step 13+ equivalent) — do after steps 1–12 are stable. Splitting the hub file while other files still reference it risks breaking the procedural chain.

`[ROI: HIGH | Effort: M | Impact: prevent-bugs/consolidate]`

---

## 10. Quick Wins

Each under 30 minutes. In priority order.

**QW1: Delete `roadmap-sync.mdc` + archive 2 stale PROJECT_STATUS files**  
Delete `.cursor/rules/roadmap-sync.mdc`. Move `AGENT_OPS_PHASE2.md` and `security-report-2026-06-01.md` to `archives/`. Removes contradiction H3, false "no backend" claim, and superseded security report.  
`[ROI: HIGH | Effort: S | Impact: prevent-bugs/clarify]`

**QW2: Trim `CURRENT_STATE.md` to ≤55 lines**  
Archive everything below the "Active Blockers" section to `archives/session-log-2026-06.md`. Cuts cold episodic data from hot-tier context load.  
`[ROI: HIGH | Effort: S | Impact: save-context]`

**QW3: Delete root `roadmap.md` and `PROJECT_PLAN.md`**  
Add one line to CURRENT_STATE.md: `Roadmap: see docs/roadmap.md`. Ends the 5-way reconciliation. `docs/project_state.md` becomes the phase truth.  
`[ROI: HIGH | Effort: S | Impact: consolidate]`

**QW4: Fix `package.json` duplicate key + move 3 orphaned scripts**  
Remove second `verify:dispatcher-nav` entry. Move `verify-typography.mjs`, `measure-typography.mjs`, `inspect-visual.mjs` to `scripts/archives/` or delete (HVAC reference is dead weight).  
`[ROI: MED | Effort: S | Impact: prevent-bugs/clarify]`

**QW5: Fix ESL_INTEGRATION_PLAN.md and close away-007**  
Check the Zone Management checkbox in ESL plan. Set `away-007` status to `"done"` with note referencing `security-report-2026-06-02.md`. Update `away-status.json` lastRun.  
`[ROI: MED | Effort: S | Impact: clarify]`

**QW6: Fix CURRENT_STATE.md encoding and security gate contradiction**  
Replace mojibake characters. In `model-dispatch-gate.mdc`, change "after commit" to "before pushing" to match orchestrator's stated intent.  
`[ROI: MED | Effort: S | Impact: prevent-bugs/clarify]`

**QW7: Add `docs/archives/` and move `stageverify_implementation_plan.md` there**  
The file's stale header + duplication with `docs/roadmap.md` makes it a confusion source. Archive it with a one-line note: "Superseded by docs/roadmap.md Phase 2 deliverables."  
`[ROI: MED | Effort: S | Impact: consolidate]`

---

## 11. Long-Term Recommendations

**LT1: Split `composer-orchestrator.mdc` into 3 focused files**  
- `composer-orchestrator.mdc` → session protocol only (~60 lines)  
- `composer-lessons.mdc` → § agent-lessons + Playwright patterns (episodic, purgeable)  
- `composer-nav-freeze.mdc` → nav IA + scope rejections (versioned with each nav change)  
This makes each piece independently updateable without risking the procedural chain.  
`[ROI: HIGH | Effort: M | Impact: clarify/consolidate]`

**LT2: Generalize `cursor-agent-brain` as a true cross-project AI OS**  
Strip all stageverify references from `SKILL.md` examples. Replace "Dan-Away" with "Owner-Away". Move `trials.json` to each project's `.cursor/` folder. Create a `SKILL.md` test: run bootstrap on a new empty repo — if any step requires stageverify knowledge, it's not generic yet.  
`[ROI: HIGH | Effort: M | Impact: reuse/clarify]`

**LT3: Implement a session-end CURRENT_STATE.md size gate**  
Add a `chore` to `ship-loop.mdc`: before commit, run `wc -l PROJECT_STATUS/CURRENT_STATE.md` and fail if > 55. Forces discipline without relying on memory.  
`[ROI: MED | Effort: S | Impact: prevent-bugs]`

**LT4: Canonicalize outcome archetype slugs**  
Add a pre-commit lint (or note in `agent-ops.mdc`) that outcome rows must use slugs from `archetypes.json`. Current mismatch (`frontend-feature`, `bug-fix`) means the tier-table recompute will produce wrong weights.  
`[ROI: MED | Effort: S | Impact: prevent-bugs]`

**LT5: Create `MODEL_DOSSIER.md` archive trigger at 180 lines**  
Current file is 171 lines — near overflow. Add a note: when any § exceeds 5 active lessons, archive the oldest 2 to `archives/dossier-notes.md` with date stamps. Keeps warm-tier context lean.  
`[ROI: MED | Effort: S | Impact: save-context]`

**LT6: Cross-project reuse strategy (6-month)**  
Once `cursor-agent-brain` is generalized (LT2), use `bootstrap/` to seed a second project. The test: a new project agent should reach "ship first feature" in one session with zero stageverify-specific knowledge loaded. If it fails, the contamination hasn't been fully removed.  
`[ROI: HIGH | Effort: L | Impact: reuse/clarify]`

---

## Appendix: Task-Type Confidence Log

| Task Type | Model Used | Confidence | Notes |
|-----------|-----------|------------|-------|
| `docs-update` (assessment write) | Composer 2.5 Fast | 95% | Pure markdown, no code changes |
