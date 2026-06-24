# Mini Librarian — Token Efficiency Report

> Planning only (2026-06-23). Aligns with `docs/aecs/librarian-plan.md` — **Retriever**, **Indexer**, **Context Packet Builder** are the levers; not full ACES Librarian.

## 1. Current mini librarian (what runs today)

| Layer | Mechanism | Files / commands |
|-------|-----------|------------------|
| **Hot tier (session start STOP)** | Always read; then stop for routine tasks | `CURRENT_STATE.md` (~30 lines), `MEMORY.md` (≤70 lines) |
| **AlwaysApply rules** | Injected every turn (fixed context cost) | 12 `.cursor/rules/*.mdc` — largest: `composer-orchestrator.mdc`, `time-awareness.mdc`, `parallel-agent-strategy.mdc` |
| **Router (warm index)** | Concern → file → when | `MEMORY.md` authority chain + narrow “what’s next to build?” |
| **Execution packet** | JSON brief for queued work | `npm run away:next` → `buildNextBrief()` in `scripts/lib/away-memory-lib.mjs` |
| **Plan packet** | Suggest-only; no queue writes | `npm run away:plan` |
| **Verifier (Indexer-lite)** | Cross-file drift checks | `npm run away:validate` — syncs `NEXT.md`, validates queue ↔ `CURRENT_STATE` ↔ `project_state.md` |
| **MODEL_DOSSIER routing** | Index-first intent; § on tag match | `MODEL_DOSSIER.md` index (lines 7–23); cold detail in `archives/dossier-notes.md` |
| **Planning scouts** | 2–4 parallel read-only scouts | `parallel-agent-strategy.mdc` § Planning question protocol (domains A–D) |
| **Pre-present verify** | Re-cross-check before answering Dan | `suggestion-verify-gate.mdc` |
| **On-demand only** | Not session start | `svscope_simple.md`, `roadmap.md` (~389 lines), `project_state.md`, full `away-list.json`, `USER_SCOPE_REJECTIONS.md` |

**ACES role mapping (partial today):** Retriever = agent tool reads + scouts; Indexer = `MEMORY.md` + dossier index + `away:validate`; Verifier = `away:validate` + `suggestion-verify-gate`; Context Packet Builder = `away:next` JSON (incomplete); Note Taker / Archivist = deferred.

---

## 2. Token waste patterns (likely today)

| Pattern | Where | Impact |
|---------|-------|--------|
| **Full dossier load** | Agents read all of `MODEL_DOSSIER.md` (~188 lines) vs index (17 lines) + one § | **High** — QR/confidence tables duplicated in context |
| **`readFirst` over-fetch** | `buildNextBrief()` always lists `svscope_simple.md` | **High** — vision doc on every queued item |
| **Planning scout duplication** | Scouts A–C each read `CURRENT_STATE`, `MEMORY`, `away-list`, `roadmap`, `project_state`; parent re-reads for synthesis; `suggestion-verify-gate` reads again | **High** on “what’s next?” questions |
| **Roadmap narrative drift** | Agents infer next work from `docs/roadmap.md` LATER/NEXT despite MEMORY narrow rule | **Medium** — wasted exploration + wrong paths |
| **Scout C grep breadth** | `TODO`/`FIXME`/`TBD` across all `src/` | **Medium** — noisy for planning answers |
| **Duplicate librarian spec** | Mini librarian block in both `composer-orchestrator.mdc` and `agent-ops.mdc` | **Low** fixed cost; confuses on-demand reads |
| **No slice retrieval** | No script to emit one dossier § or tag-matched excerpt | **Medium** — manual full-file reads |
| **`away:next` without `--minimal`** | Full JSON scope + acceptance + readFirst every time | **Low–medium** when queue head is obvious |
| **Stale multi-doc answers** | `project_state.md` + `CURRENT_STATE` + `NEXT.md` read when `away:validate` already enforces sync | **Medium** |
| **Session-start creep** | Steps 3–8 in `composer-orchestrator.mdc` (dossier, scope rejections, scouts) run when not triggered | **Medium** |

---

## 3. Improvements ranked by ROI

### Quick wins (rules/docs only — no new infra)

| Change | Token savings | Touch |
|--------|---------------|-------|
| **Index-only dossier rule** — “Read lines 7–23; open exactly one § by tag; never load § session confidence / outcome log for routine tasks” | **High** | One paragraph in `parallel-agent-strategy.mdc` or `MEMORY.md` |
| **Slim `readFirst`** — drop `svscope_simple.md` from default; add `"scopeDispute": true` flag in away item scope when needed | **High** | `scripts/lib/away-memory-lib.mjs` `buildNextBrief()` |
| **Scout A uses CLI first** — `npm run away:next -- --minimal`; expand files only if blocked/empty queue | **High** | `parallel-agent-strategy.mdc` scout table |
| **Skip scouts when narrow** — “what’s next to build?” + non-empty `away:next` → answer from JSON only (no 3-scout fan-out) | **High** | `parallel-agent-strategy.mdc` skip condition |
| **Suggestion-verify: reuse** — “If scout synthesis cited source X in this turn, do not re-read X unless contradiction suspected” | **Medium** | `suggestion-verify-gate.mdc` |
| **Rotate dossier bloat** — move outcome log + session confidence tables to `archives/dossier-notes.md`; keep index + active § only | **Medium** | `MODEL_DOSSIER.md` trim |
| **MEMORY pointer** — one row: token efficiency → this file | **Low** | `MEMORY.md` |

### Medium (scripts / index enhancements)

| Change | Token savings | Touch |
|--------|---------------|-------|
| **`npm run context:packet -- --tags qr-routing,delivery-display`** — Context Packet Builder lite: hot tier + matched § excerpts + `away:next --minimal` | **High** | New `scripts/context-packet.mjs`, `package.json` |
| **`dossier-index.json`** — tag → `{ startLine, endLine, file }` for programmatic slice | **Medium** | `PROJECT_STATUS/dossier-index.json`, validate in `away:validate` |
| **`away:next --packet`** — merge queue brief + tag-derived § slices + blocker one-liner from `CURRENT_STATE` | **High** | `away-next.mjs`, `away-memory-lib.mjs` |
| **Scout prompt: return paths + line ranges only** (≤25 lines, no pasted doc bodies) | **Medium** | Scout boilerplate in `parallel-agent-strategy.mdc` |
| **`away:validate` warnings** — dossier >120 lines, MEMORY >70, index row without § | **Low** | `away-validate.mjs` |

### Deferred (full ACES — higher build cost)

| Role | Token benefit | Cost |
|------|---------------|------|
| **Archivist** — nightly compress roadmap/LATER, dedupe lessons into summaries | High long-term | Automation + verify loop |
| **Note Taker** — conversation → structured drafts | Medium | Wrong promotion risk |
| **Full Retriever** — search index before any doc read | High at scale | Infra, maintenance |
| **Specialist agents** — bounded knowledge workers | Medium | Orchestration complexity |

---

## 4. Next 3 actions (Dan approval)

### Action 1 — Slim execution packet (Retriever + Context Packet Builder lite)
- **Scope:** Remove default `svscope_simple.md` from `readFirst`; add `npm run away:next -- --minimal` to MEMORY “what’s next” path; document `--minimal` as default for coding sessions.
- **Files:** `scripts/lib/away-memory-lib.mjs`, `PROJECT_STATUS/MEMORY.md` (1 row).
- **Expected benefit:** **High** — drops heaviest automatic read on every away item.

### Action 2 — Planning path dedup (Retriever discipline)
- **Scope:** Update planning scout protocol: Scout A runs `away:next --minimal` only; skip scouts when queue head answers the question; index-only MODEL_DOSSIER in scout table; suggestion-verify reuse clause.
- **Files:** `.cursor/rules/parallel-agent-strategy.mdc`, `.cursor/rules/suggestion-verify-gate.mdc` (1–2 lines each).
- **Expected benefit:** **High** on planning/“what’s next” turns (often 3–4× doc load).

### Action 3 — Dossier index + slice script (Indexer)
- **Scope:** Add `PROJECT_STATUS/dossier-index.json`; script `npm run dossier:slice -- --tag agent-lessons` prints one §; trim rotated content from main dossier; `away:validate` checks index ↔ file line ranges.
- **Files:** `PROJECT_STATUS/dossier-index.json`, `scripts/dossier-slice.mjs`, `MODEL_DOSSIER.md`, `away-validate.mjs`, `package.json`.
- **Expected benefit:** **Medium–high** — predictable small reads for QR, pickup, readiness tasks.

---

## 5. What NOT to do

- **Do not** replace Composer with a Librarian orchestrator — Librarian coordinates knowledge, not software builds (`librarian-plan.md`).
- **Do not** build vector DB / embedding retrieval before CLI index + slice proves insufficient.
- **Do not** auto-write `away-list.json` or PROJECT_STATUS from Note Taker drafts without Verifier + Dan approval.
- **Do not** add more alwaysApply rules to “save tokens” — prefer shorter hot tier + on-demand packets.
- **Do not** parallelize implementation to save time at the cost of duplicate context across executors.
- **Do not** merge this into full ACES Phase 3+ until `docs/aecs/phase-2-plan.md` orchestration profiles stabilize.

---

**Verified against:** `MEMORY.md`, `CURRENT_STATE.md`, `librarian-plan.md`, `composer-orchestrator.mdc`, `agent-ops.mdc`, `parallel-agent-strategy.mdc`, `MODEL_DOSSIER.md` (index + structure), `away-next.mjs`, `away-validate.mjs`, `away-plan.mjs`, `away-memory-lib.mjs`.
