# Harness Cleanup Spec — 5 Phases (Composer 2.5 execution)

> **AMENDED 2026-07-08 (post Grok 4.5 critical review).** Executor: re-read this spec at the
> START of each phase — do not work from a cached copy. Phase 1 is unchanged (and already
> EXECUTED 2026-07-08, commit `e09aeca` — do not re-run); Phases 2–5 have material changes.

> **Planned by Fable 5, approved by Dan 2026-07-08. Executor: Composer 2.5.**
> This spec is mechanical on purpose. Execute steps EXACTLY as written. Zero judgment calls.
> If anything here does not match the repo, STOP and report — do not improvise.

## Lessons-learned compression rule (Dan 2026-07-08 — philosophy, binding)

`LIBRARIAN_LESSONS.md` (and any lessons/inbox file) must NOT become a log of every failure.
It keeps only **compressed, reusable rules that change future behavior**. Specific failures get
distilled into general rules, then the specifics are archived or deleted from active memory.
Example: instead of recording every failed deploy, keep ONE rule — "verify deployment completed
before marking a phase done." Phase 1's rotation applies this: merge duplicate-cause bullets into
one general rule each; archive the specifics.

## GLOBAL HARD CONSTRAINTS (read before every phase)

1. **Never make the harness heavier.** Every commit must reduce net always-applied line count,
   file count, or duplication. Any addition must be paired with a larger deletion in the SAME commit.
2. **One phase = one session = one commit.** Never batch phases. Never start phase N+1 in the
   same session as phase N.
3. **No scope widening.** If you notice "related improvements," mention them in your report and
   do NOT implement them.
4. **After every phase:** `npm run away:validate` (must pass) and `npm run build` (must pass),
   then commit with the EXACT specified message, then `git push origin main`.
   Rules/docs-only phases: NO gh-pages deploy, NO version bump (per `version-bump-ship-gate.mdc`
   skip rules — while that file exists — and ship-loop docs-only policy after Phase 3).
5. **Stop conditions:** if `away:validate` fails and the fix is not obvious in <5 minutes, or any
   file referenced in this spec is missing/renamed, STOP and report to Dan — do not improvise.
6. **Sequencing:** Phases 1–3 execute now (sequential sessions). Phase 4 only after Dan confirms
   2–3 normal work sessions showed no regressions. Phase 5 only after Phase 4 observation passes.

## Pre-flight notes (verified against repo 2026-07-08 — adjustments vs original plan)

- **Line counts** below were measured with PowerShell `(Get-Content $f).Count` on 2026-07-08.
  The plan's "1,611 lines" baseline measures 1,596 by this method (off-by-one per file, trailing
  newline). Treat measured numbers as truth; targets are ±10%.
- **PROJECT_STATUS top level** = 32 files + `archives/` (plan said 43). Post-Phase-1 target ≈ 22
  files + `archives/`.
- **`archives/librarian-lessons-archive.md` already exists** — Phase 1 APPENDS to it (do not create).
- **`MEMORY.md` is already 70 lines** (at its ≤70 cap) — Phase 1 step is verify-only unless your
  pointer edits push it over.
- **`estimate-log.md` preamble is lines 1–97** (not 1–60 as planned); taxonomy table = lines 7–34;
  `## Log` header at line 98, data rows from line 100.
- **`away-status.json` is an object** with a `results` array (105 entries) — trim `results`,
  keep `lastRun`/`batch`/`summary` keys.
- **More pointer files than planned:** moved files are referenced not only by `CURRENT_STATE.md`
  and `gotcha-map.json` but also `indexer-memory.json`, `context-index.json`, and three `docs/`
  files. `away:validate` HARD-FAILS on missing indexer-memory slice files — Phase 1 lists every
  reference found.
- **`away:validate` guards to respect:** (a) `CURRENT_STATE.md` must keep a
  `Last shipped: **…**` line; (b) `librarian-lessons-index.json` startLine/endLine must match
  `LIBRARIAN_LESSONS.md` `##` anchors — recompute after rotation; (c) warns >35 lines
  CURRENT_STATE, >70 MEMORY.
- **aecs:** `.cursor/aecs/installed-manifest.json` exists (Phase 2 scaffold, committed 2026-06-05,
  `cdf7bf8`) — installed as scaffold, not operationally used; leave `.cursor/aecs/` untouched this
  cleanup.
- All 15 `.cursor/rules/*.mdc` files named in Phases 2–5 exist with these measured line counts:
  ship-loop 123, composer-orchestrator 317, time-awareness 206, parallel-agent-strategy 244,
  security-review-gate 73, agent-ops 48, best-reply-gate 89, Final-Answer-Review-Gate 36,
  suggestion-verify-gate 57, model-dispatch-gate 39, model-audit-gate 113, minew-nda-compliance 91,
  vendor-phone-qr 20, version-bump-ship-gate 55, session-cleanup-gate 85.

---

# PHASE 1 — Pure moves, zero behavior change ✅ EXECUTED 2026-07-08 (commit `e09aeca`) — do not re-run

**Commit message (exact):**
`chore: archive one-off reports, rotate status files, trim CURRENT_STATE to cap`

**FORBIDDEN in Phase 1:** editing any `.cursor/rules/` file; changing any rule text or behavior;
touching `src/`, `functions/`, `firestore.rules`; deleting information (archive it instead);
rewriting archived file contents (move them byte-identical).

## 1.1 Move one-off reports to `PROJECT_STATUS/archives/`

- [ ] `git mv` each of these from `PROJECT_STATUS/` to `PROJECT_STATUS/archives/` (names verified to exist):
  - `MINI_LIBRARIAN_HANDOFF.md`
  - `LIBRARIAN_TOKEN_EFFICIENCY.md`
  - `WARGAME_VENDOR_EMAIL_LAYER.md`
  - `INVOICE_4046362_INSPECTION.md`
  - `INVOICE_REVIEW_INSPECTION_4046362.md`
  - `security-report-2026-06-02.md`
  - `security-m1-vendor-revert-2026-06-08.md`
  - `security-scan-2026-07-04-invoice.md`
  - `SECURITY_GATE_AUDIT_2026-07-07.md`
  - `HANDOFF_VENDOR_EMAIL_2026-07-07.md`

## 1.2 Update every live pointer to the moved files (SAME commit)

Path-string replace only (`PROJECT_STATUS/<name>` → `PROJECT_STATUS/archives/<name>`). References
verified by grep on 2026-07-08:

- [ ] `PROJECT_STATUS/CURRENT_STATE.md` line 10 (`HANDOFF_VENDOR_EMAIL_2026-07-07.md`), line 11
  (`SECURITY_GATE_AUDIT_2026-07-07.md`), line 70 (`MINI_LIBRARIAN_HANDOFF.md`) — these lines
  survive the 1.3 trim; update paths there.
- [ ] `PROJECT_STATUS/gotcha-map.json` — lines ~124 (`LIBRARIAN_TOKEN_EFFICIENCY.md`), ~256/~286/~301
  (`SECURITY_GATE_AUDIT_2026-07-07.md`), ~287 (`security-scan-2026-07-04-invoice.md`),
  ~559/~576/~594/~638 (`HANDOFF_VENDOR_EMAIL_2026-07-07.md`), ~560 (`WARGAME_VENDOR_EMAIL_LAYER.md`).
- [ ] `PROJECT_STATUS/indexer-memory.json` — lines ~219/~235 (`HANDOFF_VENDOR_EMAIL_2026-07-07`),
  ~237 (`WARGAME_VENDOR_EMAIL_LAYER.md`), ~249/~260/~272 (`SECURITY_GATE_AUDIT_2026-07-07.md`).
  MANDATORY — `away:validate` fails on missing slice files.
- [ ] `PROJECT_STATUS/context-index.json` — line ~95 (`LIBRARIAN_TOKEN_EFFICIENCY.md`).
- [ ] `docs/roadmap.md` line ~316 (`security-report-2026-06-02.md`); `docs/location-first-transition-spec.md`
  lines ~110 and ~222 (`security-scan-2026-07-04-invoice.md`); `docs/aecs-phase1-audit.md` line ~150
  (`security-report-2026-06-02.md`). Path-only edits.
- [ ] Do NOT edit the contents of the moved files themselves (their internal cross-references may
  go stale — acceptable for archives).
- [ ] Final check: `grep` each of the 10 moved filenames repo-wide (exclude `archives/`,
  `node_modules/`, `dist/`); every remaining hit must already say `archives/` or live in an
  archived/historical file.

## 1.3 Trim `CURRENT_STATE.md` 74 → ≤30 lines

- [ ] Create `PROJECT_STATUS/archives/ship-history.md` with header `# Ship history (rotated from CURRENT_STATE.md)`
  and move ALL `- Also shipped:` lines (currently lines 13–56) into it verbatim, newest first.
- [ ] Keep in `CURRENT_STATE.md`: title + read-first header block; Snapshot trimmed to 3–4 lines
  (Active Phase, vendor-PIN D14 line, reply-ingest pilot line, security-gate evidence line may be
  compressed to one pointer line each); the `Last shipped: **…**` line EXACTLY as formatted
  (away:validate parses it); Stack + Data lines; `## Active Blockers` (all 4); `## Immediate Next Step`;
  `## Canonical references`; `## Update Protocol`.
- [ ] Result must be ≤30 lines and still contain the string `Last shipped:`.

## 1.4 Rotate `LIBRARIAN_LESSONS.md` (77 lines → ~40) applying the compression rule

- [ ] Add this header (2–3 lines) directly under the title:
  > **Compression rule (Dan 2026-07-08):** this file keeps only compressed, reusable rules that
  > change future behavior — never a log of every failure. Distill specifics into general rules;
  > archive the specifics to `archives/librarian-lessons-archive.md`.
- [ ] Merge duplicate-cause bullets into one general rule each. Verified merge candidates:
  #1 + #10-dash-bullet ("gh-pages branch push ≠ live") + Jul-3 stale-gh-pages note → one rule
  "verify deployment completed (Pages status `built` + prod verify) before marking done";
  #27 + #28 + #29 → one security-evidence rule (gate claims require `security-gate-id` + model
  invocation evidence; no verdict without them); #21–26 + #30 vendor-email pilot bullets → keep the
  flag-discipline rule + thread-hygiene rule, archive test-account/404-noise specifics.
- [ ] Move the dated session sections (`## Jul 3 2026 session`, `## Jul 4 2026 session`,
  `## Jul 7 2026 session`, lines 56–75) and all archived specifics by APPENDING to the existing
  `PROJECT_STATUS/archives/librarian-lessons-archive.md`.
- [ ] Renumber the surviving lessons cleanly from 1 (no gaps, no dash-bullet orphans).
- [ ] KEEP all six `##` section anchors (`Ship / verify`, `Dispatcher UI`, `Invoice / parser`,
  `Process / agents`, `Vendor email / reply ingest`, `Timing (pointer only)`) — gotcha-map and the
  lessons slicer address sections by these anchors.
- [ ] Update `librarian-lessons-index.json` startLine/endLine for all six sections to match the
  rotated file (away:validate fails on drift). Update the `SECURITY_GATE_AUDIT_2026-07-07.md`
  path inside any surviving lesson to `archives/…`.

## 1.5 Rotate `away-status.json`

- [ ] Create `PROJECT_STATUS/archives/away-status-archive-2026-07.json` containing the OLDEST 90
  entries of the `results` array (format precedent: `archives/away-batch-3.json` — a plain JSON file).
- [ ] Keep the NEWEST ~15 `results` entries in `away-status.json`; leave `lastRun`, `batch`,
  `summary` untouched.

## 1.6 Trim `estimate-log.md` preamble

- [ ] Compress lines 1–97 to ~25–40 lines total: keep the title + 2-line purpose, the FULL
  Type/Subtype taxonomy table (lines 7–34, keep verbatim), a compressed Roles/actual/ship-time
  digest (~8–10 lines: worker posts task-start/task-finish; librarian records; Actual = timestamp
  math only, else `unknown`; `estimate:audit` every 15 rows), and the Columns table.
- [ ] Keep `## Log` header and ALL data rows byte-identical.

## 1.7 `MEMORY.md`

- [ ] Verify still ≤70 lines after any pointer edits; trim only if over. No other changes.

## 1.8 Validate + ship (docs-only)

- [ ] `npm run away:validate` → pass. `npm run build` → pass.
- [ ] Stage ONLY the files above → commit (exact message in header) → `git push origin main`.
  No deploy. No version bump.

---

# PHASE 2 — Two-tier ship model (THE one behavior change; isolated)

**Commit message (exact):**
`feat: two-tier fast-safe/high-risk ship model in ship-loop (Dan 2026-07-08)`

**FORBIDDEN in Phase 2:** any dedup/merge work (that is Phase 3); archiving files; touching any
rule file other than the three named below; editing `src/`, `functions/`, `firestore.rules`.

## 2.1 Amend `.cursor/rules/ship-loop.mdc` (123 lines → ~105)

- [ ] DELETE these three sections entirely:
  - `## Dan's standing preference — ship every change (never wait for "ship it")` (lines 10–33)
  - `## Default deploy policy` (lines 35–41)
  - `## Backend deploy (default after gate)` (lines 84–95)
- [ ] In place of the first two deleted sections (i.e., directly after the intro line
  "After **every change** in this repo…"), PASTE this block VERBATIM:

```markdown
## Two-tier ship model (Dan 2026-07-08 — authoritative)

Classify every change by **file path** BEFORE implementation. Tier decides approval, not effort.

### Fast-safe (default — ship without asking)

**Paths:** `src/`, `public/`, `scripts/verify-*`, `docs/`, `PROJECT_STATUS/`, `.cursor/rules/`, root `package.json`, routine service logic with no auth/rules surface.

Loop unchanged: build → verify → commit → push → `npm run deploy` (when the frontend bundle changed and validation passed) → prod verify. No approval needed; **"ship it" is never required.** Rules/docs-only: commit + push; skip gh-pages when no bundle impact. Dan's safety net is `git revert <hash>` — "might need revert" is never a reason to hold ship.

### High-risk (STOP before implementation)

**Paths/changes:** `firestore.rules` (any diff, including comment-only), `functions/**` when deploying, auth/route guards, secrets/config (`firebase.json`, `.github/workflows/`, env), permissions, billing, data deletion, schema/data migrations, Gmail watch/Pub/Sub, `functions/package.json`; **any `src/` file implementing auth, route guards, session/token handling, or login logic** — the `src/` path prefix alone does NOT make a change fast-safe; **root `package.json` edits to the `scripts` section or deploy wiring** (e.g. the `deploy` script, build commands).

Protocol: **STOP before implementation** — state plan + tier, wait for Dan's explicit approval. After approval: implement → **Sonnet security gate before push** (unchanged, orthogonal — still mandatory for `backend-write-critical` regardless of approval) → push → deploy **only if approval covered deploy**.

**When tier is ambiguous, classify high-risk and ask — misclassifying down is the failure mode.**

### Edge rulings

- CF read-path change: implementation **fast-safe**; `firebase deploy --only functions` **high-risk**.
- Auth/session/token read logic: **high-risk entirely** (wherever it lives, including `src/`).
- `firestore.rules` comment-only diff: **high-risk** (file-class rule, no loophole).
- Root `package.json` ordinary dependency version bump: **fast-safe**; root `package.json` `scripts`/deploy wiring, `functions/package.json`, or firebase SDK major: **high-risk**.
- Existing hard stops stack: security gate **HIGH unfixed** or **NOT RUN** blocks push regardless of tier.

**Workspace wins:** for fast-safe changes this rule overrides the generic Cursor user rule "only commit when requested" — never leave fast-safe changes uncommitted or undeployed. **Authoritative:** this file is the source of truth for commit, push, deploy, production verification, security gate timing, and skip triggers; other rules cross-reference here.
```

- [ ] In place of the deleted `## Backend deploy (default after gate)` section, PASTE VERBATIM:

```markdown
## Backend deploy (high-risk tier)

Deploy Firebase targets only when Dan's approval covered deploy AND the security gate passed (§ Two-tier ship model). Commands: `firebase deploy --only firestore:rules --project stageverify-db` · `firebase deploy --only functions --project stageverify-db` (or scoped names). **Hard stop:** gate HIGH unfixed or NOT RUN — do not push/deploy regardless of approval.
```

- [ ] Leave ALL other ship-loop sections untouched (Sequence, When to deploy, Production
  verification, When to skip, Done gate, UI changes, PROJECT_STATUS). Result: ~100–110 lines.

## 2.2 Same commit — two pointer edits

- [ ] `.cursor/rules/composer-orchestrator.mdc` § `Pre-Action Clarification Gate` (lines 39–45):
  replace the whole section body with ONE line:
  `High-risk per ship-loop.mdc § Two-tier ship model (firestore.rules, CF deploy, auth, secrets, migrations) → state plan + tier and get Dan's approval BEFORE implementation. Fast-safe → build without asking. Still ask one focused question when scope is genuinely ambiguous.`
- [ ] `PROJECT_STATUS/FAST_UI_PROMPT.md` line 52 (`- Do NOT deploy Firestore rules, CF, backend without Dan approval`):
  append ` (high-risk tier — ship-loop.mdc § Two-tier ship model)`.

## 2.3 Validate + ship (rules/docs-only)

- [ ] `npm run away:validate` pass; `npm run build` pass; net line delta must be negative.
- [ ] Stage only the three files → commit (exact message) → push. No deploy, no version bump.

---

# PHASE 3 — Dedup merges (wording moves only — NO behavior changes)

**Commit message (exact):**
`chore: merge review/model/product rules, single-source duplicated specs`

**FORBIDDEN in Phase 3:** changing any obligation's meaning; touching the Phase-2 tier table;
touching `time-awareness.mdc` / `parallel-agent-strategy.mdc` / `composer-orchestrator.mdc` beyond
the pointer replacements listed; editing `src/` or `functions/`.

## 3.1 Create `.cursor/rules/answer-quality.mdc` (~40 lines, frontmatter `alwaysApply: true`)

Merges `best-reply-gate.mdc` (89) + `Final-Answer-Review-Gate.mdc` (36) + `suggestion-verify-gate.mdc` (57).

- [ ] MUST carry forward, verbatim in spirit: cross-check authoritative sources before presenting;
  one revise pass (rules files max 2); confidence line (`Verified against: [sources]` /
  `Caveat: [uncertainty]`); handoff prompts self-contained + minimum 2 internal passes + real
  away-NNN ids only + real npm script names only (verify in `package.json`); present only the
  final version (never v1 + "want me to improve?").
- [ ] KEEP the "What we did" completion-report lead. DROP the five-part
  Recommendation/Why/Now/Defer/Confidence template entirely (conflict resolution — Dan approved).
- [ ] Delete the three source files (`git rm`).

## 3.2 Create `.cursor/rules/model-gates.mdc` (~55 lines, `alwaysApply: true`)

Merges `model-dispatch-gate.mdc` (39) + `model-audit-gate.mdc` (113).

- [ ] Carry forward: pre-edit archetype/tier statement (announce-and-go); the T0–T3 tier table;
  escalation triggers INCLUDING the 2-fail diagnose-only rule — this file becomes the ONLY full
  copy of that rule; the post-change model-audit block + low-risk exemption.
- [ ] The security invocation section becomes a 2-line pointer to `security-review-gate.mdc`
  (which owns model lock + invocation + evidence).
- [ ] Delete the two source files.

## 3.3 Create `.cursor/rules/product-guardrails.mdc` (~25 lines, `alwaysApply: true`)

Merges `minew-nda-compliance.mdc` (91) + `vendor-phone-qr.mdc` (20).

- [ ] Keep hard prohibitions only: never commit Minew API docs/keys/login URLs/authenticated
  examples; Minew HTTP calls server-side only (CF + Firebase secrets, never `src/` client);
  `minew-confidential/` never staged; vendor phone test = demo QR page
  (`https://lgarage.github.io/stageverify/#/demo/vendor-scan`) + PIN `1234` + Playwright screenshot
  `screenshots/vendor-demo/qr-for-phone.png` in the reply; canonical vendor UI = `ReceivingPage`
  at `/#/receive` only (never rebuild separate vendor UIs); vendor PIN is job-scoped (D14).
- [ ] Create `PROJECT_STATUS/KNOWLEDGE/minew-nda.md` (new folder) and move the NDA legal detail
  there (ownership, copies/retention/5-year survival, contractor obligations, AI-usage table,
  pre-ship checklist). Add one pointer line in `product-guardrails.mdc`.
- [ ] Delete the two source files.

## 3.4 Fold into `ship-loop.mdc`

- [ ] `version-bump-ship-gate.mdc` (55) → ~6 lines inside ship-loop Sequence step 0 (bump
  `package.json` patch in same commit before build; skip when no deploy intent/docs-only/WIP
  branch; report new version). Delete the file. Remove now-dangling `version-bump-ship-gate.mdc`
  references inside ship-loop text.
- [ ] `session-cleanup-gate.mdc` (85) → ~8 lines appended to ship-loop `## Done gate`: you started
  it, you stop it (dev servers, background shells, Task subagents); delete verify PNGs
  (`before-*/after-*`, `screenshots/**` ephemeral); `git status` clean before push; ports
  5173–5176 clear; keep `playwright/.auth/state.json`. Delete the file.

## 3.5 Trim `security-review-gate.mdc` 73 → ~45

- [ ] Keep: model lock (`claude-4.6-sonnet-medium-thinking` only), the verbatim Task invocation
  block, valid-completion evidence requirements, hard stops, RC-1 UI-label caveat, RC-3 caveat.
- [ ] Adopt the stricter evidence standard from LIBRARIAN_LESSONS (rotated rule from old #28):
  UUID + model line + `actual model invocation evidence: yes/no/unknown` — UUID alone ≠ verified.
- [ ] Delete only text that is duplicated elsewhere after the 3.2 merge (forbidden-table prose,
  worker/multitask repetition now covered by `model-gates.mdc` pointers) — keep anything that
  exists only in this file.

## 3.6 Trim `agent-ops.mdc` 48 → ~30

- [ ] Delete the duplicated mini-librarian and pre-edit-gate paragraphs (now owned by
  `composer-orchestrator.mdc` / `model-gates.mdc`). Keep: profile declaration
  (`composer-default`), brain repo paths, Windows `cmd /c dir` note, STATS.md-stale note, the
  outcome-log PowerShell snippet, stageverify-vs-brain commit separation.

## 3.7 Pointer replacements (dedup remaining copies)

- [ ] `MEMORY.md`: replace the security-gate row detail (line ~65) with a one-line pointer to
  `security-review-gate.mdc`; keep the away-workflow table but ensure it is the pointer, not a
  second full copy.
- [ ] `AWAY_BUILD_PROTOCOL.md`: replace security-gate/2-fail detail (lines ~101, ~120–121) with
  pointers to `security-review-gate.mdc` / `model-gates.mdc`.
- [ ] `MODEL_DOSSIER.md`: replace duplicated 2-fail/security-gate sentences (§ index rows + line
  ~136) with pointers to `model-gates.mdc`; domain content (`composer-trace` symptom protocol) stays.
- [ ] Update every repo reference to the nine deleted rule files to point at their successor
  (`grep` each deleted filename; expect hits in `composer-orchestrator.mdc`, `MEMORY.md`,
  `FAST_UI_PROMPT.md`, `AWAY_BUILD_PROTOCOL.md`, docs).

## 3.8 Grep gate (mechanical dedup verification — REQUIRED before commit)

- [ ] Grep repo-wide (exclude `node_modules/`, `dist/`, `archives/`) for the security-gate Task
  invocation block (`subagent_type: "security-review"`) and for `security-gate-id` requirements:
  the FULL invocation block must appear in exactly ONE file — `.cursor/rules/security-review-gate.mdc`.
  All other occurrences must be ≤3-line pointers.
- [ ] Grep for `2-fail` and `diagnose-only`: the full rule must appear in exactly ONE file —
  `.cursor/rules/model-gates.mdc`. All other occurrences must be ≤3-line pointers.
- [ ] If either count is wrong, fix before committing — do not ship with duplicates.

## 3.9 Validate + ship (rules/docs-only)

- [ ] `npm run away:validate` pass; `npm run build` pass; `.cursor/rules/` now has 9 files
  (15 − 9 deleted + 3 created); net always-applied lines sharply down.
- [ ] Commit (exact message) → push. No deploy, no version bump.

---

# PHASE 4 — Trim time-awareness + parallel-agent-strategy IN PLACE (alwaysApply KEPT)

**AMENDED 2026-07-08:** the original on-demand `alwaysApply: false` flip is CANCELLED — heuristic
on-demand attachment can silently drop binding behaviors (budget filters, scout fan-out) with no
error and no test. Both files STAY `alwaysApply: true`; this phase only deletes redundant prose.

**Gate:** Dan has confirmed 2–3 normal work sessions after Phase 3 with no regressions. Do not
start without that confirmation in the current session's prompt.

**Commit message (exact):**
`chore: trim time-awareness and parallel-agent-strategy in place (alwaysApply kept)`

**FORBIDDEN in Phase 4:** flipping `alwaysApply` on ANY file; deleting either file; changing any
frontmatter; changing rule semantics — deletions of examples/duplication only; touching any other
rule file.

- [ ] `.cursor/rules/time-awareness.mdc` 206 → ~100 lines. KEEP the binding rules: budget-vs-typical
  filter (filter on budget only), never offer out-of-budget CTAs, the Remaining time options
  required-section skeleton, session-mode fork (A/B), stated-window tracking, and the FULL
  calibration anchor table (category budgets/typicals). DELETE: the worked Wrong-vs-right example
  blocks, the duplicated example markdown snippets, and prose paragraphs restating rules already
  expressed in the tables.
- [ ] `.cursor/rules/parallel-agent-strategy.mdc` 244 → ~120 lines. KEEP: roles table, default
  pipeline, the full hard-stops list, planning question protocol skeleton (triggers, scout domains
  table, orchestrator pipeline order), scout prompt boilerplate, file-ownership batch rules
  (when-to-use / when-NOT / coordinator-only paths). DELETE: worked examples, wrong-vs-right
  sections, and paragraphs duplicating `composer-orchestrator.mdc` content.
- [ ] **Rollback plan (state in report):** `git revert <hash>` — no frontmatter changed.
- [ ] `away:validate` + `build` pass → commit (exact message) → push. No deploy, no version bump.

**Deferred — NOT part of this cleanup:** converting these two files to on-demand
(`alwaysApply: false` + description triggers) may be revisited later ONLY after on-demand rule
attachment is proven reliable in this Cursor setup. Do not implement it in any phase of this spec.

---

# PHASE 5 — Orchestrator slim (highest risk — LAST, only after Phase 4 observation)

**Gate:** Phase 4 shipped AND its observation window passed (timed sessions still produce
"Remaining time options"; planning questions still fan out scouts — see regression watch below).
Do not start without Dan's go.

**Commit message (exact):**
`chore: slim composer-orchestrator to kernel, move UI-verify detail to FAST_UI_PROMPT`

**FORBIDDEN in Phase 5:** deleting any obligation without relocating it; touching rule semantics
of other files; editing `src/`/`functions/`; flipping `alwaysApply` on any file.

**MUST REMAIN ALWAYSAPPLY — never move these to on-demand docs (line targets bend before these get cut):**

- UI-verify kernel: UI change ⇒ matching `verify:*` script or before/after screenshots BEFORE
  "done", + auth via `playwright/.auth/state.json`.
- Security-gate pointer and its hard stop (HIGH unfixed / NOT RUN blocks push).
- Session-start hot-tier steps (`CURRENT_STATE.md` + `MEMORY.md` first).
- The two-tier ship table (fast-safe / high-risk classifier).
- The post-edit build gate (`npm run build` clean before done).

- [ ] `composer-orchestrator.mdc` 317 → ~110:
  - Extract § UI Verification Protocol + Playwright command reference (~95 lines) into
    `PROJECT_STATUS/FAST_UI_PROMPT.md` (which already duplicates about half — merge, net delete).
  - Keep a 3-line alwaysApply kernel in its place: `UI change ⇒ matching verify:* script or before/after screenshots BEFORE "done"; protected routes auth via playwright/.auth/state.json (node scripts/playwright-auth-setup.mjs); load PROJECT_STATUS/FAST_UI_PROMPT.md for the full protocol.`
  - Move completion-report + timing-table formats (~35 lines) into `AWAY_BUILD_PROTOCOL.md`;
    leave a 1-line pointer.
  - Delete § Session Defaults paragraphs that duplicate ship-loop (ship loop, deploy, git
    commits+push) → 1-line pointers to `ship-loop.mdc`.
- [ ] **End-state check (must hold before commit):** `.cursor/rules/` contains exactly 9 files,
  ALL `alwaysApply: true` — 7 core ≈ 450 lines (ship-loop ~105, composer-orchestrator ~110,
  model-gates ~55, security-review-gate ~45, answer-quality ~40, agent-ops ~30,
  product-guardrails ~25) + 2 trimmed (time-awareness ~100, parallel-agent-strategy ~120) →
  total ≈ 670–700 always-applied lines, down from 1,611 planned / 1,596 measured (~57% reduction).
  Report actual counts.
- [ ] `away:validate` + `build` pass → commit (exact message) → push. No deploy, no version bump.

---

# Post-phase smoke test (EVERY phase)

- [ ] Preferred: one routine fast-safe ship end-to-end in the next normal session; at minimum
  `npm run build` + `npm run away:validate` green before declaring the phase done.

# Regression watch (report anything seen to Dan)

- `learning-pending.json` auto-captures verify/deploy failures — check it after each phase.
- `verify:dispatcher-nav` catches missed version bumps.
- Missing "Remaining time options" sections in timed sessions, or planning questions answered
  without scout fan-out, after Phase 4 = the trim cut a binding rule → `git revert` the Phase 4
  commit and report.
