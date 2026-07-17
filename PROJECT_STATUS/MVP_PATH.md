# StageVerify — MVP Path (SSOT)

> **Read for:** MVP %, gap analysis, planning/priority, away planning, "what's next to reach MVP."
> **MVP bar:** `PROJECT_STATUS/svscope_simple.md` §14 (27-step daily shop loop) — **excluding** e-tags / ESL (D-26; §14 step 26 is post-MVP product).
> **Last assessed:** 2026-07-12 — Fable + Grok confer → baseline **80.00%** (joint confidence 82); e-tag band removed 2026-07-12 (D-26).

## Current percent (SSOT)

**99.60%** — update here + `CURRENT_STATE.md` snapshot on every MVP milestone ship (2 decimal places). Rule: `.cursor/rules/mvp-completion-report.mdc` (D-25).

## Standing directive (all future sessions)

When Dan or agents ask about progress, priorities, planning, or "what's next":

1. **Analyze the full MVP landscape** — not queue head alone. Cross-check: this file, `svscope_simple.md` §14, `docs/roadmap.md` traceability, `docs/project_state.md`, blockers in `CURRENT_STATE.md`.
2. **Produce the fastest clear path to MVP** — rank only work that closes an exit criterion below; label each item **in-repo** vs **Dan/external**; skip post-MVP unless it blocks an exit criterion.
3. **Do not inflate %** with harness, agent-ops, Phases 7–9, **or e-tag/ESL work** (D-26 — not in MVP scope).

Planning answers must lead with: current % → top gaps → fastest path (ordered, with owner) → what is explicitly deferred.

---

## Completion bands (baseline 2026-07-12)

| Band | Weight | Score | Remaining to 100% |
|------|--------|-------|-------|
| Core loop (vendor → stage → pickup) | 65% | 1.00 | **0.00%** |
| Email / Condition 1 ingest | 20% | 1.00 | **0.00%** |
| §14 full E2E integration gate | 15% | 1.00 | **0.00%** |
| **Total remaining** | — | — | **0.40%** → 100.00% |

**Explicitly out of MVP scope (D-26 — not in %, criteria, or path):** e-tags / ESL / Minew / §14 step 26; location-first Phases 5–6; Phases 7–9 AI automation; App Check; harness/agent-ops; physical shop-map/sign printing (Jake Korb). Post-MVP product: `ESL_INTEGRATION_PLAN.md`.

## Partial credit (increment math)

When MVP-scoped work ships, add: `delta = band_remaining × milestone_fraction` (round **2 decimals**, sum onto SSOT).

| Exit criterion / band | Budget left | Example milestones → delta |
|-----------------------|-------------|----------------------------|
| §14 E2E gate | 1.71% | scaffold + local + prod PASS done; residual band only |
| Live email ingest | 8.00% | Pub/Sub + deploy +4.00%; first live message linked +4.00% |
| Combination honesty | 1.30%* | waive doc +0.65%; atomic release shipped +0.65% |
| Core regression re-verify | 1.30% | prod verify bundle green after MVP-touching ship +1.30% |

\*Combo work draws from core-loop remainder unless full criterion closure is recorded in checklist.

**Example:** E2E harness scaffold ships, no verify yet → `80.00%` + `1.71%` ≈ **`81.71%`** (E2E band redistributed after e-tag removal).

---

## MVP done — exit criteria (checklist)

- [x] **§14 E2E gate PASS** — `verify:phase14-e2e` local PASS (2026-07-12); `verify:phase14-e2e:prod` **PASS** (2026-07-12, main post-PR#18; deep-link reset for hideSeedDemoRows)
- [x] **Live email ingest operable** — poll/Refresh Now + Needs Review prod proof (away-128/129, 2026-07-12); **2** inbound visible; Gmail connected. Push-primary Pub/Sub is **optional** (not MVP-blocking) — see `CURRENT_STATE` blocker #3.
- [x] **Core regression green** — `verify:mvp-core-regression:prod` **PASS** 2026-07-17 post–vendor hub v0.0.44 (pickup, dispatcher-nav, location Phase 4 **15/15**; vendor leg skipped without STAGEVERIFY_* env — same as 2026-07-12)
- [x] **Combination scope honest** — **MVP waiver (2026-07-12):** atomic multi-location combo assign+release with real Jake Korb shop-map IDs is **explicitly out of MVP done**. Stub (`combinationStagingGroupId` / away-036/037) + emulator coverage (`test:pickup-authority`) remain; production combo signage waits on shelving decision. Placeholder IDs acceptable for demo/dev only.

---

## Fastest path to MVP (priority order)

| # | Action | Closes | Owner | Blocks daily loop? |
|---|--------|--------|-------|-------------------|
| 1 | ~~Dan GCP Gmail checklist~~ → deploy inbound CF + rules → reconnect OAuth | Live email criterion | **Done** 2026-07-12 (away-128 deploy confirm; away-129 prod Needs Review **2** inbound) | No |
| 2 | ~~Core regression prod re-verify~~ **Done** — `verify:mvp-core-regression:prod` PASS 2026-07-12 (full vendor leg) | Core regression | — | No |
| 3 | ~~§14 E2E gate prod~~ **Done** — `verify:phase14-e2e:prod` PASS 2026-07-12 | E2E exit criterion | — | No |
| 4 | ~~Combination release decision~~ **Done** — MVP waiver documented 2026-07-12 | Combination honesty | — | No |

| 5 | ~~§14 E2E residual prod re-verify~~ **Done** — away-130 PASS 2026-07-17 post–vendor hub v0.0.44 | Residual §14 band | — | No |

**Optional (not MVP-blocking):** GCP Pub/Sub push-primary ingest — Dan configures per `project_state.md`; poll/Refresh Now path proven (away-129).

**Defer until after MVP done:** location-first Phases 5–6, Phase 7–9 product phases, harness Phase 2 auto-gotcha, ESLint cleanup batches unrelated to exit criteria, **all e-tag/ESL work (D-26)**.

---

## Post-MVP workflow backlog (not in MVP %)

> Revisit after MVP is operational with **requirements restated** and verify/tests. **Not** exit criteria.

| Workflow | SSOT | Notes |
|----------|------|-------|
| **E-tag / ESL / Minew** | `ESL_INTEGRATION_PLAN.md`, **D-26** | §14 step 26; excluded from MVP entirely |
| **Location-first Phases 5–6** | `location-first-transition-spec.md` | Technician door; management audit |
| **Combination atomic release** | Combo waiver in checklist above | Real Jake Korb IDs |
| **Physical shop-map / sign printing** | Jake Korb blocker | Production sign batch |

---

## Gap reference (ranked)

1. ~~§14 E2E residual prod re-verify~~ **Done** 2026-07-17 (away-130)
2. ~~Live Gmail ingest~~ **Done** 2026-07-12 (away-128/129); optional push-primary Pub/Sub — Dan/external
3. ~~Core regression prod re-verify~~ **Done** 2026-07-12 (re-run after v0.0.44 = away-130)
4. Combination location release incomplete — **medium**, in-repo (real IDs: Jake Korb; waived for MVP done)
5. Physical shop map — **medium-low**; sign printing only; not core software loop
6. ~~§14 E2E gate prod~~ **Done** 2026-07-12

---

## Assessment history

| Date | % | Models | Notes |
|------|---|--------|-------|
| 2026-07-12 | 80.00 | Fable 82 + Grok 79 → confer | Baseline; `work-verifier: f8d92887`; `confer: cc0c25e0` |
| 2026-07-12 | 80.00 | D-25 rule | Mandatory % reporting in work replies; SSOT 2-decimal updates |
| 2026-07-12 | 80.65 | Composer | Combo honesty waiver documented (+0.65% core-loop band) |
| 2026-07-12 | 81.75 | Composer | §14 E2E gate scaffold `verify:phase14-e2e` (+1.10% E2E band, pre-redistribution) |
| 2026-07-12 | — | Dan | ~~86.75% e-tag waiver~~ **superseded** — e-tag removed from MVP model (D-26) |
| 2026-07-12 | 85.17 | Composer | §14 E2E gate local PASS `verify:phase14-e2e` (+3.42% E2E band); focused pickup readback replaces full delivery-consistency in chain |
| 2026-07-12 | 88.59 | Composer | §14 E2E gate prod PASS `verify:phase14-e2e:prod` (+3.42%); reset deep-link for hideSeedDemoRows |
| 2026-07-12 | 89.89 | Composer | Core regression prod PASS `verify:mvp-core-regression:prod` (+1.30%); vendor deep-link + leg order fix |
| 2026-07-12 | 93.89 | Composer | Live email deploy confirm away-128 (+4.00% email band); CF+rules prod |
| 2026-07-17 | 99.60 | Composer | away-130 §14 E2E residual prod re-verify (+1.71% §14 band); post–vendor hub v0.0.44 |

Re-assess when any exit criterion closes or a major phase ships. **Do not** bump % without shipped+verified milestone evidence.
