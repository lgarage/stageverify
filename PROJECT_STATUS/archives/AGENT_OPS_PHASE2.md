# agent-ops Phase 2 — Reference

> **ARCHIVED 2026-06-04** — Stale (claimed "no backend yet"; Firestore/rules/CF are live). Superseded by `docs/project_state.md` and agent-ops SKILL.md.

> **Cold-tier file.** Read this only when you are asked about Phase 2, the playbook
> system, the critical-trial ladder, or why the agent-ops system "learns from mistakes."
> Do NOT read at session startup — CURRENT_STATE.md + SKILL.md cover everything needed.

---

## What is Phase 2?

Phase 2 is the next planned evolution of the agent-ops efficiency system
(see `C:\Projects\cursor-agent-brain\SKILL.md` for the live skill).

Phase 1 (already built and running) gives you:
- A global tier table that routes tasks to the cheapest capable model.
- A Dan-Away batch queue for running pre-approved tasks unattended.
- A nightly GitHub Actions job that recomputes the tier table from logged outcomes.
- A STATS.md readiness counter in the brain repo.

Phase 2 adds two things that Phase 1 deliberately left out:

---

## Phase 2a — Playbook Injection

**What it is:**
Per-archetype lesson files (`cursor-agent-brain/playbooks/<archetype>.md`) that
accumulate failure-derived lessons and are injected into subagent prompts before
work begins on that archetype.

**Why it matters:**
When a cheap model fails at, say, a Tailwind layout, the root cause (e.g. "flex
parent needs min-h-0 or the child won't scroll") gets written to
`playbooks/css-restyle.md`. The next time any agent attempts a css-restyle task,
that lesson is in its prompt — so it succeeds where the model previously failed.
The model doesn't get smarter; the *system* gets smarter by accumulating hard-won
knowledge as prompt context.

**Cap:** each playbook is limited to ~8 lessons. When a 9th is added, the weakest
(least-repeated) lesson is merged or dropped in-context to keep playbooks lean.

**Build trigger:**
Worth building when you notice the same archetype repeatedly failing or needing
rework. Roughly 15+ logged outcomes is a useful signal threshold (check
`cursor-agent-brain/STATS.md` for the current count).

---

## Phase 2b — Critical-Tier Earn-Your-Way-Up Ladder

**What it is:**
A graded trial system for the `backend-write-critical` archetype (auth, security
rules, schema/data migrations, payments). Currently locked at Opus 4.6 permanently.
Phase 2b allows cheaper models to *attempt* critical work in trial mode, with a
stronger model grading the output before it ships.

**How it works:**
1. Cheaper model produces the change but does NOT ship it — output is held.
2. A stronger model (or you) grades it: clean pass vs. needed-fixes vs. fail.
3. Grade is recorded in `cursor-agent-brain/trials.json`.
4. After n≥5 **clean passes** (grader changed nothing), the cheaper model earns
   the right to ship critical work solo.
5. Failures write a lesson to `playbooks/backend-write-critical.md` (the teaching
   loop) — the cheap model gets another trial *with the lesson in context*.
6. One real fail (not a style nit) resets the trial counter and re-locks to Opus.

**Why it's deferred:**
stageverify has no backend yet (no Firebase/Supabase). The `backend-write-critical`
archetype is currently DORMANT — there is nothing for the trial ladder to grade.
Activate Phase 2b the moment a backend lands. Until then it's pointless.

**Cost note:**
During the trial phase you pay for both: a cheap model attempts + a strong model
grades. Net-cheaper only once the cheap model earns solo status. This is an
investment that pays off after promotion.

---

## When to build Phase 2

Check `cursor-agent-brain/STATS.md` (updated nightly). It shows:
- Total outcomes logged
- Per-archetype breakdown
- A `N/15` Phase-2 readiness indicator

**Phase 2a (playbooks):** build when STATS shows ≥15 outcomes AND you're noticing
repeat rework on the same archetype. Ask the agent "are we ready for Phase 2?" and
it will read STATS.md and give an honest yes/no.

**Phase 2b (critical-trial ladder):** build when stageverify gains a backend
(Firebase/Supabase persistence, auth, or security rules land). The backend landing
is the trigger, not the outcome count.

---

## Where things live

| Piece | Location |
|---|---|
| Live skill (global tier table, protocol) | `C:\Projects\cursor-agent-brain\SKILL.md` |
| Archetype definitions | `C:\Projects\cursor-agent-brain\archetypes.json` |
| Nightly recompute script | `C:\Projects\cursor-agent-brain\scripts\recompute-tier-table.js` |
| Per-machine outcome logs | `C:\Projects\cursor-agent-brain\outcomes\<machine>.jsonl` |
| Learning status / Phase-2 readiness | `C:\Projects\cursor-agent-brain\STATS.md` |
| Phase 2a playbooks (not yet built) | `C:\Projects\cursor-agent-brain\playbooks\<archetype>.md` |
| Phase 2b trial state (not yet built) | `C:\Projects\cursor-agent-brain\trials.json` |
| This file (stageverify context) | `PROJECT_STATUS/AGENT_OPS_PHASE2.md` |
