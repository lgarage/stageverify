# StageVerify — MVP Path (SSOT)

> **Read for:** MVP %, gap analysis, planning/priority, away planning, "what's next to reach MVP."
> **MVP bar:** `PROJECT_STATUS/svscope_simple.md` §14 (27-step daily shop loop).
> **Last assessed:** 2026-07-12 — Fable + Grok confer → baseline **80.00%** (joint confidence 82).

## Current percent (SSOT)

**86.75%** — update here + `CURRENT_STATE.md` snapshot on every MVP milestone ship (2 decimal places). Rule: `.cursor/rules/mvp-completion-report.mdc` (D-25).

## Standing directive (all future sessions)

When Dan or agents ask about progress, priorities, planning, or "what's next":

1. **Analyze the full MVP landscape** — not queue head alone. Cross-check: this file, `svscope_simple.md` §14, `docs/roadmap.md` traceability, `docs/project_state.md`, blockers in `CURRENT_STATE.md`.
2. **Produce the fastest clear path to MVP** — rank only work that closes an exit criterion below; label each item **in-repo** vs **Dan/external**; skip post-MVP unless it blocks an exit criterion.
3. **Do not inflate %** with harness, agent-ops, or Phases 7–9 work unless explicitly in scope for an exit criterion.

Planning answers must lead with: current % → top gaps → fastest path (ordered, with owner) → what is explicitly deferred.

---

## Completion bands (baseline 2026-07-12)

| Band | Weight | Score | Remaining to 100% |
|------|--------|-------|-------|
| Core loop (vendor → stage → pickup) | 65% | 0.98 | **1.30%** |
| Email / Condition 1 ingest | 20% | 0.60 | **8.00%** |
| E-tag / ESL live (§14 step 26) | 5% | 1.00 | **0.00%** |
| §14 full E2E integration gate | 10% | 0.45 | **5.50%** |
| **Total remaining** | — | — | **13.25%** → 100.00% |

**Explicitly out of this %:** location-first Phases 5–6, Phases 7–9 (AI/ESL automation — **e-tag frozen D-26**), App Check, harness/agent-ops, physical shop-map/sign printing (Jake Korb). Existing **Push to E-Tag** print-label UI and zone `eslTagId` fields remain; live Minew sync is post-MVP.

## Partial credit (increment math)

When MVP-scoped work ships, add: `delta = band_remaining × milestone_fraction` (round **2 decimals**, sum onto SSOT).

| Exit criterion / band | Budget left | Example milestones → delta |
|-----------------------|-------------|----------------------------|
| §14 E2E gate | 5.50% | script scaffold +1.10%; local PASS +2.20%; prod PASS +2.20% |
| Live email ingest | 8.00% | Pub/Sub + deploy +4.00%; first live message linked +4.00% |
| Combination honesty | 1.30%* | waive doc +0.65%; atomic release shipped +0.65% |
| E-tag waiver or live demo | 5.00% | Dan waiver recorded +5.00%; live demo +5.00% |
| Core regression re-verify | 1.30% | prod verify bundle green after MVP-touching ship +1.30% |

\*Combo work draws from core-loop remainder unless full criterion closure is recorded in checklist.

**Example:** E2E harness scaffold ships, no verify yet → `80.00%` + `1.10%` = **`81.10%`**. Small step (e.g. **80.33%**) = proportional fraction of the relevant budget (here ~6% of E2E band gap).

---

## MVP done — exit criteria (checklist)

- [ ] **§14 E2E gate PASS** — `npm run verify:phase14-e2e` (local) + `verify:phase14-e2e:prod` — scaffold shipped; full PASS pending
- [ ] **Live email ingest operable** — Gmail watch/Pub/Sub configured; one real inbound message links to a delivery without manual workaround
- [ ] **Core regression green** — pickup, vendor, dispatcher, location Phase 4 release verifies PASS on prod after latest deploy
- [x] **Combination scope honest** — **MVP waiver (2026-07-12):** atomic multi-location combo assign+release with real Jake Korb shop-map IDs is **explicitly out of MVP done**. Stub (`combinationStagingGroupId` / away-036/037) + emulator coverage (`test:pickup-authority`) remain; production combo signage waits on shelving decision. Placeholder IDs acceptable for demo/dev only.
- [x] **E-tag closed or waived** — **MVP freeze (D-26, 2026-07-12):** live Minew ESL automation explicitly **out of MVP done**; revisit post-MVP with verify/tests. Manual print-label + zone `eslTagId` assignment unchanged.

---

## Fastest path to MVP (priority order)

| # | Action | Closes | Owner | Blocks daily loop? |
|---|--------|--------|-------|-------------------|
| 1 | Build + run **§14 E2E gate** (`npm run verify:phase14-e2e` + `:prod`) | E2E exit criterion | **In-repo** — scaffold shipped; run local+prod PASS to close | No |
| 2 | **Dan GCP Gmail checklist** → deploy inbound CF + rules → reconnect OAuth | Live email criterion | **Dan** (GCP) + deploy | No for manual Condition 1; yes for automated evidence |
| 3 | ~~Combination release decision~~ **Done** — MVP waiver documented 2026-07-12 | Combination honesty | — | No |
| 4 | ~~E-tag waiver~~ **Done** — D-26 freeze: ESL post-MVP + tests | E-tag criterion | — | No |

**Parallel while blocked on Dan:** run `verify:phase14-e2e` local+prod (item 1) — do not wait on Pub/Sub. **Do not** start e-tag/Minew work (D-26 freeze).

**Defer until after MVP done:** location-first Phases 5–6, **Phase 7 ESL / e-tag automation (D-26 — revisit with tests)**, Phase 8–9 AI, harness Phase 2 auto-gotcha, ESLint cleanup batches unrelated to exit criteria.

---

## Gap reference (ranked)

1. §14 full E2E gate not passed — **high**, in-repo
2. Live Gmail ingest (Pub/Sub + IAM + deploy) — **high**, Dan/external
3. Combination location release incomplete — **medium**, in-repo (real IDs: Jake Korb)
4. Live ESL / e-tag (step 26) — **frozen for MVP (D-26)**; post-MVP + tests
5. Physical shop map — **medium-low**; sign printing only; not core software loop

---

## Assessment history

| Date | % | Models | Notes |
|------|---|--------|-------|
| 2026-07-12 | 80.00 | Fable 82 + Grok 79 → confer | Baseline; `work-verifier: f8d92887`; `confer: cc0c25e0` |
| 2026-07-12 | 80.00 | D-25 rule | Mandatory % reporting in work replies; SSOT 2-decimal updates |
| 2026-07-12 | 80.65 | Composer | Combo honesty waiver documented (+0.65% core-loop band) |
| 2026-07-12 | 81.75 | Composer | §14 E2E gate scaffold `verify:phase14-e2e` (+1.10% E2E band) |
| 2026-07-12 | 86.75 | Dan | E-tag/ESL frozen for MVP — D-26 waiver (+5.00% e-tag band) |

Re-assess when any exit criterion closes or a major phase ships. **Do not** bump % without shipped+verified milestone evidence.
