# AI OS Extraction — Phase 1 Implementation Plan

> **Status:** PROPOSAL ONLY — do not implement until approved  
> **Generated:** 2026-06-04  
> **Scope:** Memory/rules/brain-repo separation — **no** StageVerify app code, schema, UI, deployment, or feature files  
> **Companion:** [`portable-ai-os-report.md`](./portable-ai-os-report.md)

---

## 1. Phase 1 Objective

Separate the portable AI operating system (`cursor-agent-brain`) from StageVerify-specific trial data, examples, and orchestration overrides — while preserving StageVerify's Composer 2.5 Fast orchestration as an **explicit, documented profile** rather than an accidental conflict with the global Sonnet-default policy.

**Mandatory scope items:**

| # | Requirement | Rationale |
|---|-------------|-----------|
| 1 | Reconcile global Sonnet-orchestrator policy with StageVerify Composer policy | #1 portability blocker |
| 2 | Composer 2.5 default orchestrator/worker for stageverify environment | Billing + Auto+Composer quota |
| 3 | Sonnet 4.6 rare escalation only (security verifier, 2nd failed fix) | Cost control |
| 4 | Move `trials.json` into StageVerify repo | Trial data is 100% stageverify |
| 5 | Remove StageVerify-specific examples from `cursor-agent-brain/SKILL.md` | Decontamination |
| 6 | Add generic placeholders/templates where project examples exist | Bootstrap new projects |
| 7 | Create bootstrap rule templates for future projects | One-session seeding |
| 8 | Evaluate `composer-orchestrator.mdc` split — justify defer or proceed | Stability vs maintainability |

**Explicit exclusions:**

- StageVerify `src/`, `firestore.rules`, Cloud Functions, `package.json` feature scripts
- `npm run deploy`, Firebase rules deploy
- Splitting `composer-orchestrator.mdc` (**deferred** — see §8)
- Modifying `PROJECT_STATUS/` content beyond `trials.json` path reference
- Touching outcome `.jsonl` historical rows

---

## 2. composer-orchestrator.mdc Split Decision

### Verdict: **DO NOT SPLIT in Phase 1**

| Criterion | Assessment |
|-----------|------------|
| Stability | Phase 1 memory cleanup (711b16f) and parallel-agent-strategy (f7d2c44) just landed; split adds cross-reference churn |
| Risk | 7 rule files reference orchestrator; split requires updating all pointers in one atomic change |
| Benefit timing | Split pays off after global SKILL decontamination — otherwise lessons and procedures stay coupled anyway |
| Current line count | ~230 lines — manageable with caps discipline |
| Prerequisite | Extraction Phase 1 complete + orchestration profile documented |

### Phase 2 split plan (reference only)

If split is approved later:

```
composer-orchestrator.mdc      (~60 lines)  session start, build gate, authority chain
composer-playwright.mdc        (~80 lines)  Playwright CLI, auth state, verify scripts
composer-lessons.mdc           (~50 lines)  episodic lessons, MODEL_DOSSIER pointers
```

**Phase 1 action:** Add one line to `composer-orchestrator.mdc` header:

```markdown
> Split deferred to Phase 2 per docs/ai-os-extraction-phase-1-plan.md §2.
> Do not split until global SKILL decontamination is complete.
```

---

## 3. Exact Files to Change

### 3.1 cursor-agent-brain (global OS repo)

| File | Change | Risk |
|------|--------|------|
| `C:\Projects\cursor-agent-brain\SKILL.md` | Decontaminate examples; add orchestration profiles §; update trials.json path; rename Dan-Away → Owner-Away | **MED** |
| `C:\Projects\cursor-agent-brain\README.md` | Fix install path; update layout section; remove Dan-Away branding | **LOW** |
| `C:\Projects\cursor-agent-brain\playbooks\security-review.md` | Replace Firebase-specific checklist with generic auth/route checklist | **LOW** |
| `C:\Projects\cursor-agent-brain\playbooks\backend-write-critical.md` | Remove `npm run build` / stageverify-specific build commands if present | **LOW** |
| `C:\Projects\cursor-agent-brain\docs\orchestration-profiles.md` | **CREATE** — Sonnet-default vs Composer-default patterns | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\rules\ship-loop.mdc.template` | **CREATE** from stageverify `ship-loop.mdc` | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\rules\session-cleanup-gate.mdc.template` | **CREATE** | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\rules\model-dispatch-gate.mdc.template` | **CREATE** | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\rules\model-audit-gate.mdc.template` | **CREATE** | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\rules\agent-ops-bridge.mdc.template` | **CREATE** from `agent-ops.mdc` with placeholders | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\rules\parallel-agent-strategy.mdc.template` | **CREATE** | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\CURRENT_STATE.md.template` | **RENAME** from `CURRENT_STATE.md`; add `.template` suffix for clarity | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\MODEL_DOSSIER.md.template` | **RENAME** from `MODEL_DOSSIER.md` | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\away-list.json.template` | **RENAME** from `away-list.json` | **LOW** |
| `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\away-status.json.template` | **RENAME** from `away-status.json` | **LOW** |
| `C:\Projects\cursor-agent-brain\trials.json` | **DELETE** after move to stageverify | **MED** |

### 3.2 stageverify repo

| File | Change | Risk |
|------|--------|------|
| `c:\Projects\stageverify\.cursor\trials.json` | **CREATE** — moved from brain repo | **LOW** |
| `c:\Projects\stageverify\.cursor\rules\agent-ops.mdc` | Add explicit orchestration profile declaration; update trials.json path | **LOW** |
| `c:\Projects\stageverify\.cursor\rules\composer-orchestrator.mdc` | Add split-deferred note (1 line) | **LOW** |
| `c:\Projects\stageverify\docs\portable-ai-os-report.md` | Already created (this planning session) | **LOW** |
| `c:\Projects\stageverify\docs\ai-os-extraction-phase-1-plan.md` | Already created (this document) | **LOW** |

### 3.3 Files explicitly NOT changed

| File | Reason |
|------|--------|
| `src/**` | App code exclusion |
| `firestore.rules`, `functions/**` | Schema/backend exclusion |
| `package.json` (feature scripts) | Deployment exclusion |
| `PROJECT_STATUS/CURRENT_STATE.md` | No content change; only agent-ops path update |
| `PROJECT_STATUS/MODEL_DOSSIER.md` | Project-specific lessons stay |
| `parallel-agent-strategy.mdc` (content) | Already correct; only cross-ref to trials path |
| `ship-loop.mdc`, `session-cleanup-gate.mdc`, etc. (content) | Stageverify-specific values stay |

---

## 4. Exact Files to Move

| From | To | Risk | Notes |
|------|-----|------|-------|
| `C:\Projects\cursor-agent-brain\trials.json` | `c:\Projects\stageverify\.cursor\trials.json` | **MED** | Copy first, verify references, then delete source |
| `C:\Projects\cursor-agent-brain\bootstrap\CURRENT_STATE.md` | `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\CURRENT_STATE.md.template` | **LOW** | Reorganize bootstrap folder |
| `C:\Projects\cursor-agent-brain\bootstrap\MODEL_DOSSIER.md` | `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\MODEL_DOSSIER.md.template` | **LOW** | Same |
| `C:\Projects\cursor-agent-brain\bootstrap\away-list.json` | `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\away-list.json.template` | **LOW** | Same |
| `C:\Projects\cursor-agent-brain\bootstrap\away-status.json` | `C:\Projects\cursor-agent-brain\bootstrap\PROJECT_STATUS\away-status.json.template` | **LOW** | Same |

**No moves from stageverify to brain repo** — extraction is brain → generic, not project → global.

---

## 5. Rollback Plan

Each step is independently reversible.

### 5.1 trials.json move

```powershell
# Rollback: restore brain copy, delete stageverify copy
Copy-Item c:\Projects\stageverify\.cursor\trials.json C:\Projects\cursor-agent-brain\trials.json
Remove-Item c:\Projects\stageverify\.cursor\trials.json
git -C C:\Projects\cursor-agent-brain checkout HEAD -- trials.json
git -C c:\Projects\stageverify checkout HEAD -- .cursor/trials.json .cursor/rules/agent-ops.mdc
```

### 5.2 SKILL.md decontamination

```powershell
git -C C:\Projects\cursor-agent-brain checkout HEAD -- SKILL.md README.md
```

### 5.3 Bootstrap template creation

```powershell
git -C C:\Projects\cursor-agent-brain checkout HEAD -- bootstrap/
Remove-Item -Recurse -Force C:\Projects\cursor-agent-brain\bootstrap\rules\ -ErrorAction SilentlyContinue
Remove-Item C:\Projects\cursor-agent-brain\docs\orchestration-profiles.md -ErrorAction SilentlyContinue
```

### 5.4 stageverify rule updates

```powershell
git -C c:\Projects\stageverify checkout HEAD -- .cursor/rules/agent-ops.mdc .cursor/rules/composer-orchestrator.mdc
```

### 5.5 Full rollback (both repos)

```powershell
git -C C:\Projects\cursor-agent-brain reset --hard HEAD~1   # if single commit
git -C c:\Projects\stageverify reset --hard HEAD~1          # if single commit
```

**Pre-flight safeguard:** Tag both repos before starting:

```powershell
git -C C:\Projects\cursor-agent-brain tag pre-extraction-phase1
git -C c:\Projects\stageverify tag pre-extraction-phase1
```

---

## 6. What Remains Project-Specific

After Phase 1, these stay in StageVerify only:

| Asset | Location |
|-------|----------|
| Trial ladder + graded task history | `.cursor/trials.json` |
| Composer orchestration override | `.cursor/rules/agent-ops.mdc` |
| Playwright verify scripts per route | `scripts/verify-*.mjs` |
| Full composer-orchestrator (incl. Playwright CLI) | `.cursor/rules/composer-orchestrator.mdc` |
| Parallel scout strategy (Composer-tuned) | `.cursor/rules/parallel-agent-strategy.mdc` |
| gh-pages + Firebase deploy commands | `.cursor/rules/ship-loop.mdc` |
| QR / pickup / dispatcher lessons | `PROJECT_STATUS/MODEL_DOSSIER.md` |
| Nav scope rejections | `PROJECT_STATUS/USER_SCOPE_REJECTIONS.md` |
| Phase truth + V2 roadmap | `docs/project_state.md`, `docs/roadmap.md` |
| Product architecture | `docs/stageverify_v2_architecture.md` |
| Windows shell `cmd /c dir` note | `.cursor/rules/agent-ops.mdc` |
| All `src/` code + inline rationale | `src/**` |
| Stageverify outcome rows | `cursor-agent-brain/outcomes/*.jsonl` (historical, unchanged) |

---

## 7. What Becomes Portable

After Phase 1, these work for any new repo without stageverify knowledge:

| Asset | Location | Change |
|-------|----------|--------|
| Decontaminated SKILL.md | `cursor-agent-brain/SKILL.md` | Generic examples + orchestration profiles |
| Archetype slugs | `cursor-agent-brain/archetypes.json` | Unchanged |
| Tier table recompute | `cursor-agent-brain/scripts/` | Unchanged |
| Generic playbooks | `cursor-agent-brain/playbooks/` | Firebase refs removed |
| Bootstrap PROJECT_STATUS templates | `cursor-agent-brain/bootstrap/PROJECT_STATUS/` | Renamed `.template` |
| Bootstrap rule templates | `cursor-agent-brain/bootstrap/rules/` | **NEW** |
| Orchestration profiles doc | `cursor-agent-brain/docs/orchestration-profiles.md` | **NEW** |
| Outcome logging protocol | SKILL.md §8 | Unchanged |
| Away-list (Owner-Away) protocol | SKILL.md §4 | Renamed, generic |
| Security gate pattern | SKILL.md §11 + playbooks | Generic checklist |
| Trial ladder *schema* | SKILL.md §Phase 2b | Path → `<project>/.cursor/trials.json` |

---

## 8. SKILL.md Decontamination — Proposed Text Snippets

### 8.1 Header / description (line 1–11)

**Replace:**

```markdown
The orchestrator runs on **Sonnet 4.6**;
Opus is an escalation ceiling only (hard decomposition / critical grading).
```

**With:**

```markdown
The **default orchestrator** runs on **Sonnet 4.6** (see § Orchestration Profiles).
Repos may opt into a **Composer profile** via `.cursor/rules/agent-ops-bridge.mdc`.
Opus is an escalation ceiling only (hard decomposition / critical grading).
```

### 8.2 New section — Orchestration Profiles (insert before §10)

```markdown
## Orchestration Profiles

Two supported profiles. Each repo declares its active profile in
`.cursor/rules/agent-ops-bridge.mdc` (or equivalent).

### Profile A — Sonnet-default (global default)
- **Orchestrator:** Sonnet 4.6 — plans, delegates, monitors; does not edit source directly.
- **Workers:** Tier-table models via Task subagent.
- **Gate:** Interactive 4-line classification block; wait for proceed (§3).
- **Best for:** Repos without a project-specific override; complex multi-file features.

### Profile B — Composer-default (opt-in)
- **Orchestrator + worker:** Composer 2.5 Fast — implements T0–T2 inline.
- **Scouts:** Parallel read-only subagents per `parallel-agent-strategy.mdc`.
- **Gate:** Announce-and-go (archetype + tier stated, then edit immediately).
- **Sonnet 4.6:** Rare escalation only — security verifier, 2nd failed fix, confStart < 70.
- **Best for:** Repos with Auto+Composer quota; rapid iteration on UI and service logic.

**Conflict resolution:** Project `.cursor/rules/` override wins over this SKILL default.
If both load, the project bridge file is authoritative for orchestration.
```

### 8.3 §4 Dan-Away → Owner-Away

**Replace all occurrences:**

| Find | Replace |
|------|---------|
| `Dan-Away` | `Owner-Away` |
| `"go build the away list"` | `"go build the away list"` (unchanged — generic enough) |
| `report to Dan` | `report to the owner` |
| `Notify Dan` | `Notify the owner` |
| `escalate to Dan` | `escalate to the owner` |

### 8.4 §11 Security Review Gate — checklist decontamination

**Replace Firebase-specific checklist:**

```markdown
  - **Open redirect** — any `?next=` or redirect param validated against internal paths only?
  - **Unprotected route** — new routes that should be protected but aren't inside `ProtectedRoute`?
  - **Auth bypass** — any way to reach protected data/UI without login?
  - **Firestore exposure** — direct Firestore imports outside the service layer?
```

**With generic checklist:**

```markdown
  - **Open redirect** — any redirect/query param validated against an allowlist of internal paths?
  - **Unprotected route** — new routes that should require auth but are publicly reachable?
  - **Auth bypass** — any path to protected data/UI without passing the app's auth guard?
  - **Data layer exposure** — direct DB/client SDK calls outside the designated service layer?
  - **Injection surface** — unescaped user content rendered as HTML or passed to shell/query?
  - **Input validation gap** — user-controlled inputs persisted without sanitization?
  - **Secret leak** — API keys, tokens, or PII in client bundles, logs, or responses?
```

**Replace trigger line:**

```markdown
- Every `multi-file-feature` or `routing-wiring` commit that touches: auth flows, route
  protection (`ProtectedRoute`), login/logout, `?next=` redirects, or new public routes.
```

**With:**

```markdown
- Every `multi-file-feature` or `routing-wiring` commit that touches: auth flows, route
  guards, login/logout, redirect parameters, or new public/private route boundaries.
```

### 8.5 §Phase 2b trials.json path

**Replace:**

```markdown
Tracked in `cursor-agent-brain/trials.json`. Schema:
```

**With:**

```markdown
Tracked in `<project>/.cursor/trials.json` (per-repo; NOT in the brain repo). Schema:
```

**Replace auto-trigger rule (line ~439):**

```markdown
On every `backend-write-critical` task, read `trials.json` FIRST, then route:
```

**With:**

```markdown
On every `backend-write-critical` task, read `<project>/.cursor/trials.json` FIRST, then route:
```

### 8.6 §10 Sonnet source-file edit gate — add profile note

Add after the gate table:

```markdown
**Profile B exception:** When the active profile is Composer-default (see § Orchestration
Profiles), the orchestrator MAY edit source files inline for T0–T2 tasks per the project's
`model-dispatch-gate.mdc`. The Sonnet-only edit gate applies to Profile A sessions.
```

### 8.7 §3 Model gate — add profile note

Add:

```markdown
**Profile B (Composer-default):** Replace "wait for proceed" with announce-and-go per
the project's `model-dispatch-gate.mdc`. The 4-line block is still mandatory; edits
follow immediately after.
```

---

## 9. Bootstrap Rule Templates — File List and Snippets

### 9.1 Template inventory

| Template file | Placeholders |
|--------------|-------------|
| `bootstrap/rules/ship-loop.mdc.template` | `<REPO>`, `<DEPLOY_COMMAND>`, `<RULES_DEPLOY_COMMAND_OR_NONE>` |
| `bootstrap/rules/session-cleanup-gate.mdc.template` | `<DEV_PORT>`, `<DEV_PORT_RANGE>`, `<VERIFY_ARTIFACT_GLOB>` |
| `bootstrap/rules/model-dispatch-gate.mdc.template` | `<ORCHESTRATOR_MODEL>`, `<DEFAULT_WORKER_MODEL>` |
| `bootstrap/rules/model-audit-gate.mdc.template` | None (copy as-is) |
| `bootstrap/rules/agent-ops-bridge.mdc.template` | `<REPO>`, `<BRAIN_REPO_PATH>`, `<ORCHESTRATION_PROFILE>`, `<ORCHESTRATOR_MODEL>` |
| `bootstrap/rules/parallel-agent-strategy.mdc.template` | `<ORCHESTRATOR_MODEL>`, `<PROJECT_DOSSIER_PATH>` |

### 9.2 agent-ops-bridge.mdc.template (full proposed content)

```markdown
---
description: Bridge to global agent-ops skill; declares orchestration profile for <REPO>.
alwaysApply: true
---

# agent-ops loop (<REPO>)

This repo uses the **agent-ops** skill (git source: <BRAIN_REPO_PATH>).
Follow it every session unless this file explicitly overrides.

## Orchestration profile: <ORCHESTRATION_PROFILE>
<!-- Values: "sonnet-default" | "composer-default" -->

<ORCHESTRATOR_MODEL> is the **orchestrator and default worker** for this repo.
Sonnet 4.6 is rare escalation only (security verifier, 2nd failed fix, confStart < 70).
Opus 4.6 is locked fallback only if Sonnet's security gate finds HIGH risk the orchestrator cannot resolve.

## Session start (read order — STOP after this)
1. `PROJECT_STATUS/CURRENT_STATE.md` (hot tier).
2. The agent-ops skill's Global Tier Table (SKILL.md §2).
Do NOT read archives or `outcomes/*.jsonl` during normal work.

## During work
- Classify each task into an archetype; route per `model-dispatch-gate.mdc`.
- PRE-EDIT GATE: state archetype + tier + dispatch decision before any file edit.
- Parallel read-only scouts per `parallel-agent-strategy.mdc` when triggers apply.
- `backend-write-critical`: orchestrator implements inline if composer-default; Sonnet security gate before push.
- Trial state: read `.cursor/trials.json` (NOT the brain repo).

## Session end
Append ONE outcome line to the brain repo per SKILL.md §8, then commit+push brain repo.
Project commits stay in this repo. Keep the two pushes separate.
```

### 9.3 model-dispatch-gate.mdc.template (header snippet)

```markdown
> **Billing priority (<REPO>):** <ORCHESTRATOR_MODEL> is the orchestrator and default worker.
> Sonnet 4.6 is expensive (API on-demand). Only escalate when triggers in
> `parallel-agent-strategy.mdc` apply.

## Tier defaults (<REPO>)

| Tier | Archetypes | Model |
|------|-----------|-------|
| T0 | `ui-component`, `css-restyle`, `docs-update`, read-only scout | **<DEFAULT_WORKER_MODEL>** (inline) |
| T1 | `multi-file-feature`, `type-refactor`, `service-logic` | **<DEFAULT_WORKER_MODEL>** (inline) |
| T2 | multi-file with auth/routing/data reads | **<DEFAULT_WORKER_MODEL>** (inline, escalate if uncertain) |
| T3 | `backend-write-critical` | **<DEFAULT_WORKER_MODEL>** (inline) — Sonnet security gate before push |
```

### 9.4 ship-loop.mdc.template (deploy section snippet)

```markdown
## Sequence

1. `git status` — stage **only** task-related files.
2. Conventional commit (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
3. `git push origin main` — must succeed.
4. `<DEPLOY_COMMAND>` — must succeed or report failure clearly.

<RULES_DEPLOY_COMMAND_OR_NONE>
```

---

## 10. Implementation Sequence

Execute in this order to minimize broken references.

| Step | Action | Repo | Risk |
|------|--------|------|------|
| 1 | Tag `pre-extraction-phase1` on both repos | both | LOW |
| 2 | Copy `trials.json` → `stageverify/.cursor/trials.json` | stageverify | LOW |
| 3 | Update `agent-ops.mdc` trials path + profile declaration | stageverify | LOW |
| 4 | Create `docs/orchestration-profiles.md` | brain | LOW |
| 5 | Apply SKILL.md decontamination snippets (§8) | brain | MED |
| 6 | Update README.md install path + layout | brain | LOW |
| 7 | Generalize `playbooks/security-review.md` | brain | LOW |
| 8 | Reorganize `bootstrap/PROJECT_STATUS/*.template` | brain | LOW |
| 9 | Create `bootstrap/rules/*.template.mdc` (§9) | brain | LOW |
| 10 | Delete `cursor-agent-brain/trials.json` | brain | MED |
| 11 | Add split-deferred note to `composer-orchestrator.mdc` | stageverify | LOW |
| 12 | Verify: grep brain repo for `stageverify`, `ProtectedRoute`, `Dan-Away` — expect zero | brain | LOW |
| 13 | Verify: grep stageverify for `cursor-agent-brain/trials.json` — expect zero | stageverify | LOW |
| 14 | Commit brain repo | brain | — |
| 15 | Commit stageverify repo | stageverify | — |

**No build gate required** — docs and rules only.  
**No deploy** — per scope exclusion.

---

## 11. One Commit vs Multiple Commits

### Recommendation: **Two commits** (one per repo)

| Approach | Verdict | Rationale |
|----------|---------|-----------|
| Single commit | ❌ Not possible | Changes span two git repos (`cursor-agent-brain` + `stageverify`) |
| Two commits (one per repo) | ✅ **Recommended** | Clean atomic rollback per repo; brain repo push is independent |
| Multiple commits per repo | ⚠️ Optional | Only if Step 5 (SKILL decontamination) needs review pause |

### Proposed commit messages

**cursor-agent-brain:**

```
chore: extraction phase 1 — decontaminate SKILL, add bootstrap rule templates

- Add orchestration profiles (Sonnet-default + Composer opt-in)
- Move trials.json ownership to per-project .cursor/
- Rename Dan-Away → Owner-Away; generic security checklist
- Add bootstrap/rules/*.template.mdc and PROJECT_STATUS/*.template
- Remove trials.json from brain repo
```

**stageverify:**

```
chore: extraction phase 1 — adopt local trials.json, declare Composer profile

- Add .cursor/trials.json (moved from cursor-agent-brain)
- Update agent-ops.mdc with explicit orchestration profile + trials path
- Add split-deferred note to composer-orchestrator.mdc
- Add docs/portable-ai-os-report.md and docs/ai-os-extraction-phase-1-plan.md
```

### Why not squash into stageverify only?

The brain repo changes are the portability deliverable. Leaving brain repo unchanged would mean every new project still loads stageverify-biased SKILL.md — defeating Phase 1.

---

## 12. Verification Checklist (Post-Implementation)

| Check | Command / action | Expected |
|-------|-----------------|----------|
| trials.json exists locally | `Test-Path c:\Projects\stageverify\.cursor\trials.json` | `True` |
| trials.json gone from brain | `Test-Path C:\Projects\cursor-agent-brain\trials.json` | `False` |
| No Dan-Away in SKILL | `rg "Dan-Away" C:\Projects\cursor-agent-brain\SKILL.md` | No matches |
| No ProtectedRoute in SKILL | `rg "ProtectedRoute" C:\Projects\cursor-agent-brain\SKILL.md` | No matches |
| No stageverify in SKILL examples | `rg -i "stageverify" C:\Projects\cursor-agent-brain\SKILL.md` | No matches in examples |
| Profile declared | `rg "ORCHESTRATION_PROFILE\|composer-default" c:\Projects\stageverify\.cursor\rules\agent-ops.mdc` | Match |
| Bootstrap templates exist | `dir C:\Projects\cursor-agent-brain\bootstrap\rules\` | 6 `.template` files |
| App code untouched | `git diff --stat src/` | Empty |
| Orchestration profiles doc | `Test-Path C:\Projects\cursor-agent-brain\docs\orchestration-profiles.md` | `True` |

---

## 13. Risk Summary

| Change | Risk | Mitigation |
|--------|------|------------|
| SKILL.md decontamination | **MED** | Tag pre-extraction; snippet-based edits; grep verification |
| trials.json delete from brain | **MED** | Copy-before-delete; update all path refs first |
| Bootstrap reorganization | **LOW** | Rename only; update README |
| agent-ops.mdc profile line | **LOW** | Additive change; no behavior change |
| composer-orchestrator split | **N/A** | Deferred |
| Outcome jsonl history | **NONE** | Not touched |

---

## 14. Phase 2 Preview (Out of Scope)

For planning continuity only — **do not implement in Phase 1:**

1. Split `composer-orchestrator.mdc` into 3 files
2. Add CURRENT_STATE line-count gate to ship-loop
3. Outcome slug lint + STATS.md stale fix
4. Bootstrap acceptance test on a second empty repo
5. `playbooks/` full decontamination pass (all archetypes)

---

*This document is a proposal. Implementation requires explicit approval from Dan.*
