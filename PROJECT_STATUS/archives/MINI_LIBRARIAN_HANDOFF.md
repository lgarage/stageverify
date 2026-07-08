# Mini-Librarian / ACES Session Handoff

> **Created:** 2026-06-24 · **Session:** mini-librarian phase 2→3 · **Use:** paste starter prompt at bottom into a fresh Cursor chat for full continuity.

---

## 1. Purpose & design law

### Version 2 framing

**Messy context → compressed truth → faster action.**

Agents were drowning in duplicated reads (full dossier, svscope on every away item, 3–4 scouts re-reading the same files). The mini-librarian is the **context subsystem** that compresses what gets loaded and when — not a second orchestrator.

### Core law

> **Minimum sufficient context.** Context paid every turn must earn its place.

| Principle | Meaning |
|-----------|---------|
| Hot tier STOP | `CURRENT_STATE.md` + `MEMORY.md` only at session start for routine tasks |
| Index-first | Read pointers and slices — never ingest whole markdown files to find one § |
| On-demand only | `svscope_simple.md`, full `roadmap.md`, full `MODEL_DOSSIER.md` load only when triggered |
| Librarian ≠ Composer | Librarian coordinates **knowledge retrieval**; Composer owns **build/verify/ship** |
| Verifier gates promotion | `away:validate` + `suggestion-verify-gate` before presenting plans or shipping memory edits |

Full ACES roles (Note Taker, Archivist, Specialist Agents) remain **deferred** per `docs/aecs/phase-2-plan.md`. What runs today is **Retriever + Indexer + Verifier lite + Context Packet Builder (partial)**.

---

## 2. What shipped (2026-06-23/24)

### Indexer infrastructure (live)

| Asset | Purpose |
|-------|---------|
| `PROJECT_STATUS/dossier-index.json` | Tag → `{ file, startLine, endLine }` for MODEL_DOSSIER § |
| `npm run dossier:slice -- --tag <tag>` | Emit one § without full dossier load |
| `npm run dossier:slice -- --list` | List indexed tags |
| `PROJECT_STATUS/context-index.json` v2 | Concern → dossier tags + roadmap/project_state section slices |
| `npm run context:lookup -- --concern "…"` | Route concern to files, tags, and line-range slices |
| `scripts/lib/dossier-index-lib.mjs` | Shared index validation + slice logic |
| `away:validate` drift checks | Warns on dossier-index and context-index anchor/line drift |

### Away items built this session

| ID | Title | Commit | Notes |
|----|-------|--------|-------|
| **away-075** | Planning path dedup (Action 2) | `61f3c58` | Scout A → `away:next --minimal` first; skip scouts when queue head answers; index-only dossier in scout table |
| **away-076** | context-index v2 (Action 3) | `61f3c58` | Roadmap NOW/NEXT/LATER + project_state section slices in context-index; context-lookup line-range slicing |
| **away-082** | Slim execution packet (Action 1) | `af8f79a` | `buildNextBrief()` drops default `svscope_simple.md` from readFirst; `scopeDispute` flag adds it on demand |
| **away-084** | Task-trigger gotcha map + steps 6–8 CLI | `4b2ca83` | `gotcha-map.json` + `npm run context:gotcha`; 27 triggers; away-validate drift checks |

### Rules & bookkeeping

| Change | Commit | Detail |
|--------|--------|--------|
| Parallel Composer preference | `61f3c58` | `parallel-agent-strategy.mdc` § Dan standing preference — prefer parallel Composer 2.5 domain executors when paths are clearly disjoint |
| Suggestion-verify reuse | `61f3c58` | Scouts cited source X → do not re-read X unless contradiction suspected |
| away-075/076 commit refs | `a613c54` | away-status.json commit hash corrections |
| Opus review + queue reconciliation | `af8f79a` | Fixed away-082/084 mislabel; away-084 librarian scope correctly marked deferred; overnight queue restored |
| away-082 status hash | `2307d57` | away-status commit field aligned to af8f79a |
| Overnight batch queued | `d087ebf` | away-087 → 083 → 085 → 086 added to away-list.json executionProtocol.sequence |

### Key commits (reference)

```
61f3c58  feat: mini-librarian planning dedup + context-index slices (away-075, away-076)
af8f79a  fix: reconcile away-082/084 status and queue for overnight per Opus review
d087ebf  chore: queue mini-librarian phase 3 overnight batch (away-077+)
a613c54  chore: correct away-075/076 commit refs in away-status
2307d57  chore: away-082 status commit hash af8f79a
```

---

## 3. Tonight's overnight batch (GO — pre-flight passed)

**Status:** Approved. Pre-flight passed. Dan says **`go build it`** or runs `npm run away:batch`.

**Constraints (all items):** docs/scripts/rules only — **no product UI**, no Firebase/CF/Firestore rules, no gh-pages deploy, no firebase deploy.

### Sequence

| Order | ID | Title | Tier | Est. | verifyBeforeNext |
|-------|-----|-------|------|------|------------------|
| 1 | **away-087** | Verify Action 1: readFirst excludes svscope unless scopeDispute | T0 | ~10 min | `away:validate`, `build` |
| 2 | **away-083** | away:ship + validate sync project_state Immediate Next #1 | T1 | ~35 min | `away:validate` |
| 3 | **away-085** | context:packet + away:next --packet | T1 | ~45 min | `away:validate`, `build` |
| 4 | **away-086** | Rotate cold dossier § to archives (**optional**) | T0 | ~35 min | `away:validate` |

### What each item does

- **away-087** — Gate verify: confirm `npm run away:next` JSON readFirst omits `svscope_simple.md` by default; `scopeDispute: true` adds it. No code change unless verify fails.
- **away-083** — Extend `away:ship` (and validate sync if needed) so `docs/project_state.md` ## Immediate Next Steps item #1 stays aligned with queue head (same rule as CURRENT_STATE + NEXT.md).
- **away-085** — New `scripts/context-packet.mjs` + `npm run context:packet -- --tags <tags>`; extend `away-next.mjs` with `--packet` flag merging queue brief + tag slices + blocker one-liner.
- **away-086** — OPTIONAL: move outcome log + session confidence tables from MODEL_DOSSIER to `archives/dossier-notes.md`; update dossier-index line ranges. **Skip if prior items consumed batch time.**

### Bedtime trigger

```
go build it
```
or
```
npm run away:batch
```

**Skip away-086** if time is tight — 083 + 085 deliver the highest librarian ROI; 086 is dossier hygiene.

---

## 4. Deferred / not in tonight's batch

| Item | Why deferred | Priority |
|------|--------------|----------|
| **away-069** | Gmail reply sync/watch — SPEC ONLY; blocked on Dan queue + approval | Phase 6; not overnight |
| **alwaysApply rule diet** | Biggest per-turn token win (~12 `.mdc` files injected every turn) | **Daytime only** — needs careful editing + verify; do not rush overnight |
| **Full Note Taker / Archivist** | Wrong-promotion risk; automation cost | Deferred per librarian-plan.md |
| **Librarian npm package** | Portable install story not ready | **Tier A now:** copy-paste bootstrap from stageverify scripts + indexes |

---

## 5. Known issues / WARNs

Run `npm run away:validate` to reproduce.

| Issue | Severity | Detail |
|-------|----------|--------|
| MEMORY.md 73 lines | WARN | Target ≤70; trim 3 lines when convenient (indexer row + token efficiency row added this session) |
| context-index anchor drift | WARN | `project-state-known-issues` and `project-state-immediate-next` — anchors expect `## …` but file has `---` horizontal rules at those lines; update context-index.json line ranges or project_state.md structure |
| away-084 mislabeled in away-status | FIXED | Status now `deferred` with note explaining UI vs librarian scope confusion (Opus review) |
| CURRENT_STATE Last shipped format | FIXED | away-091 backfill for Reset Pickup Link label ship; CURRENT_STATE + away-status synced |

---

## 6. Honest ROI assessment (SV vs meta)

### What helps StageVerify ship

| Lever | SV impact |
|-------|-----------|
| Away batch (product UI items) | **Direct** — dispatcher, pickup, receive, readiness |
| Gotcha map (away-084 librarian) | **High** — task-trigger → which files/rules to load; prevents QR/pickup/readiness repeat mistakes |
| Ship loop + verify scripts | **Direct** — prod confidence |
| Indexer + slim readFirst | **Indirect** — faster/cheaper sessions → more builds per dollar |

### Tonight's batch ROI

| Metric | Assessment |
|--------|------------|
| Agent/orchestration ROI | **~60%** — better packets, less duplicate read, synced Immediate Next |
| Product/user ROI | **0%** — no UI, no CF, no customer-facing change |
| Still worth running unattended? | **Yes** — low risk, docs/scripts only, compounds every future session |

### Priority call

**away-084 (gotcha map) > away-086 (dossier trim)** for StageVerify mistake prevention. Re-queue 084 immediately after tonight's batch completes.

---

## 7. Opus monetization summary (brief)

**Sell the context accountant, not role hierarchy.**

Dan's portable AI OS pitch (see `docs/portable-ai-os-report.md`):

- **Must-have for monetization:** one-command portable install + **token proof dashboard** (before/after bytes loaded per session)
- **Nice-to-have:** concern → slice routing, away queue integration, drift verifier
- **Do not sell:** full ACES role taxonomy, vector DB, "Librarian replaces Composer"
- **Opus role in stageverify:** reconciliation/review passes (away-082/084 fix), not default implementer — Composer 2.5 inline; Sonnet security gate before push

---

## 8. Portability (tier A now, npm package later)

| Tier | What | Status |
|------|------|--------|
| **A — copy-paste bootstrap** | `dossier-index.json`, `context-index.json`, `scripts/dossier-slice.mjs`, `scripts/context-lookup.mjs`, `scripts/lib/dossier-index-lib.mjs`, MEMORY.md pattern | **Live in stageverify** — copy to new repo, swap paths |
| **B — npm package `@stageverify/librarian`** | CLI + validate hooks + template indexes | **Deferred** — needs API stability + tier A dogfooding |
| **C — full portable AI OS** | Decontaminated SKILL.md, profile system, token dashboard | Phase 1–3 in `docs/portable-ai-os-report.md` |

Bootstrap checklist for new repo: hot tier files → dossier-index → context-index → `away:validate` drift checks → MEMORY router rows.

---

## 9. Key files & commands reference

### Files

| File | Role |
|------|------|
| `PROJECT_STATUS/CURRENT_STATE.md` | Hot tier snapshot (~30 lines) |
| `PROJECT_STATUS/MEMORY.md` | Router index (≤70 lines target) |
| `PROJECT_STATUS/away-list.json` | Active queue + executionProtocol.sequence |
| `PROJECT_STATUS/away-status.json` | Append-only built/blocked/deferred log |
| `PROJECT_STATUS/dossier-index.json` | MODEL_DOSSIER § line ranges |
| `PROJECT_STATUS/context-index.json` | Concern + roadmap/project_state slices |
| `PROJECT_STATUS/LIBRARIAN_TOKEN_EFFICIENCY.md` | ROI analysis + Action 1–3 spec |
| `docs/aecs/librarian-plan.md` | ACES role hierarchy (deferred roles marked) |
| `scripts/lib/away-memory-lib.mjs` | buildNextBrief, itemScopeDispute, readFirst |
| `.cursor/rules/parallel-agent-strategy.mdc` | Planning scouts + parallel Composer preference |

### Commands

| Command | When |
|---------|------|
| `npm run away:next` | Before coding queued work — full JSON brief |
| `npm run away:next -- --minimal` | Narrow "what's next" — default for coding sessions |
| `npm run away:plan` | Away/sleep first question — suggest only, no queue writes |
| `npm run away:batch` | Execute queued sequence — verify → ship → validate per item |
| `npm run away:preflight` | Run verifyBeforeNext for queued items before bedtime |
| `npm run away:ship -- --id <id> --note "…"` | Mark item built after verify; `--note` = summary only; timing → `estimate-log.md` |
| `npm run away:validate` | Drift checks before commit; after memory edits |
| `npm run dossier:slice -- --tag <tag>` | One MODEL_DOSSIER § |
| `npm run context:lookup -- --concern "…"` | Concern → files + slices |
| `npm run context:gotcha -- --task "…"` | Task trigger → orchestrator steps 6–8 reads |
| `npm run build` | TypeScript gate after script changes |

---

## 10. Recommended next conversation priorities (ranked)

1. **If bedtime:** run overnight batch (`go build it` → away-087 → 083 → 085 → optional 086)
2. **If morning after batch:** review away-status.json + run `npm run away:validate`; fix context-index anchor drift + MEMORY trim
3. **Re-queue away-084** librarian gotcha map (HIGH SV ROI — task-trigger → readFirst/rules)
4. **alwaysApply rule diet** (daytime, careful) — biggest per-turn token win
5. **Product work** — Phase 5 email parsing, dispatcher polish, vendor receive (see roadmap NOW)
6. **Tier B npm package** — only after tier A stable across 2+ sessions

---

## 11. STARTER PROMPT FOR NEXT CONVERSATION

Copy everything inside the block below verbatim:

```
Read PROJECT_STATUS/MINI_LIBRARIAN_HANDOFF.md first — full context from the 2026-06-23/24 mini-librarian / ACES session.

Mode: [ACTIVE NOW | AWAY EXECUTE — pick one]

If AWAY EXECUTE: run npm run away:preflight, then npm run away:batch for the approved overnight sequence (away-087 → away-083 → away-085 → away-086 optional). Constraints: docs/scripts/rules only — no product UI, no gh-pages deploy, no firebase deploy. Skip away-086 if time tight.

If ACTIVE NOW (morning follow-up): (1) npm run away:validate and fix WARNs (MEMORY 73 lines, context-index anchor drift on project_state sections), (2) re-queue away-084 librarian gotcha map — HIGH SV ROI, was mislabeled as drawer UI, (3) product work or alwaysApply rule diet if time allows.

Session start STOP after hot tier: CURRENT_STATE.md + MEMORY.md only. Use npm run away:next -- --minimal for "what's next." Index-first: npm run dossier:slice / context:lookup — never load full MODEL_DOSSIER or svscope unless scopeDispute.

Do not deploy unless I ask. Confirm mode before executing.
```

---

**Verified against:** `CURRENT_STATE.md`, `away-list.json`, `away-status.json`, `LIBRARIAN_TOKEN_EFFICIENCY.md`, `librarian-plan.md`, `context-index.json`, `dossier-index.json`, git log (61f3c58, af8f79a, d087ebf, a613c54, 2307d57), `npm run away:validate` output 2026-06-24.
