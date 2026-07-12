# StageVerify — MVP Path (SSOT)

> **Read for:** MVP %, gap analysis, planning/priority, away planning, "what's next to reach MVP."
> **MVP bar:** `PROJECT_STATUS/svscope_simple.md` §14 (27-step daily shop loop) — **excluding** e-tags / ESL (D-26; §14 step 26 is post-MVP product).
> **Last assessed:** 2026-07-12 — Fable + Grok confer → baseline **80.00%** (joint confidence 82); e-tag band removed 2026-07-12 (D-26).

## Current percent (SSOT)

**85.17%** — update here + `CURRENT_STATE.md` snapshot on every MVP milestone ship (2 decimal places). Rule: `.cursor/rules/mvp-completion-report.mdc` (D-25).

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
| Core loop (vendor → stage → pickup) | 65% | 0.98 | **1.30%** |
| Email / Condition 1 ingest | 20% | 0.60 | **8.00%** |
| §14 full E2E integration gate | 15% | 0.66 | **5.13%** |
| **Total remaining** | — | — | **14.83%** → 100.00% |

**Explicitly out of MVP scope (D-26 — not in %, criteria, or path):** e-tags / ESL / Minew / §14 step 26; location-first Phases 5–6; Phases 7–9 AI automation; App Check; harness/agent-ops; physical shop-map/sign printing (Jake Korb). Post-MVP product: `ESL_INTEGRATION_PLAN.md`.

## Partial credit (increment math)

When MVP-scoped work ships, add: `delta = band_remaining × milestone_fraction` (round **2 decimals**, sum onto SSOT).

| Exit criterion / band | Budget left | Example milestones → delta |
|-----------------------|-------------|----------------------------|
| §14 E2E gate | 8.55% | script scaffold +1.71%; local PASS +3.42%; prod PASS +3.42% |
| Live email ingest | 8.00% | Pub/Sub + deploy +4.00%; first live message linked +4.00% |
| Combination honesty | 1.30%* | waive doc +0.65%; atomic release shipped +0.65% |
| Core regression re-verify | 1.30% | prod verify bundle green after MVP-touching ship +1.30% |

\*Combo work draws from core-loop remainder unless full criterion closure is recorded in checklist.

**Example:** E2E harness scaffold ships, no verify yet → `80.00%` + `1.71%` ≈ **`81.71%`** (E2E band redistributed after e-tag removal).

---

## MVP done — exit criteria (checklist)

- [ ] **§14 E2E gate PASS** — `verify:phase14-e2e` **local PASS** (2026-07-12, PR `cursor/mvp-phase14-e2e-gate-b498`); `verify:phase14-e2e:prod` pending after merge/deploy
- [ ] **Live email ingest operable** — Gmail watch/Pub/Sub configured; one real inbound message links to a delivery without manual workaround
- [ ] **Core regression green** — pickup, vendor, dispatcher, location Phase 4 release verifies PASS on prod after latest deploy
- [x] **Combination scope honest** — **MVP waiver (2026-07-12):** atomic multi-location combo assign+release with real Jake Korb shop-map IDs is **explicitly out of MVP done**. Stub (`combinationStagingGroupId` / away-036/037) + emulator coverage (`test:pickup-authority`) remain; production combo signage waits on shelving decision. Placeholder IDs acceptable for demo/dev only.

---

## Fastest path to MVP (priority order)

| # | Action | Closes | Owner | Blocks daily loop? |
|---|--------|--------|-------|-------------------|
| 1 | Run **§14 E2E gate prod** (`verify:phase14-e2e:prod` after merge) | E2E exit criterion | **Dan** merge PR #17 → prod verify | No |
| 2 | **Dan GCP Gmail checklist** → deploy inbound CF + rules → reconnect OAuth | Live email criterion | **Dan** (GCP) + deploy | No for manual Condition 1; yes for automated evidence |
| 3 | ~~Combination release decision~~ **Done** — MVP waiver documented 2026-07-12 | Combination honesty | — | No |

**Parallel while blocked on Dan:** run `verify:phase14-e2e` local+prod (item 1) — do not wait on Pub/Sub.

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

1. §14 E2E gate prod verify pending — **high**, Dan merge + `verify:phase14-e2e:prod`
2. Live Gmail ingest (Pub/Sub + IAM + deploy) — **high**, Dan/external
3. Combination location release incomplete — **medium**, in-repo (real IDs: Jake Korb; waived for MVP done)
4. Physical shop map — **medium-low**; sign printing only; not core software loop

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

Re-assess when any exit criterion closes or a major phase ships. **Do not** bump % without shipped+verified milestone evidence.
