# StageVerify — MVP Path (SSOT)

> **Read for:** MVP %, gap analysis, planning/priority, away planning, "what's next to reach MVP."
> **MVP bar:** `PROJECT_STATUS/svscope_simple.md` §14 (27-step daily shop loop).
> **Last assessed:** 2026-07-12 — Fable + Grok confer → **80%** complete (joint confidence 82).

## Standing directive (all future sessions)

When Dan or agents ask about progress, priorities, planning, or "what's next":

1. **Analyze the full MVP landscape** — not queue head alone. Cross-check: this file, `svscope_simple.md` §14, `docs/roadmap.md` traceability, `docs/project_state.md`, blockers in `CURRENT_STATE.md`.
2. **Produce the fastest clear path to MVP** — rank only work that closes an exit criterion below; label each item **in-repo** vs **Dan/external**; skip post-MVP unless it blocks an exit criterion.
3. **Do not inflate %** with harness, agent-ops, or Phases 7–9 work unless explicitly in scope for an exit criterion.

Planning answers must lead with: current % → top gaps → fastest path (ordered, with owner) → what is explicitly deferred.

---

## Completion: 80%

| Band | Weight | Score | Notes |
|------|--------|-------|-------|
| Core loop (vendor → stage → pickup) | 65% | 0.98 | V2 Phases 1–4 + location-first Phases 1–4 shipped; prod verifies green |
| Email / Condition 1 ingest | 20% | 0.60 | Offline prototype + `processInboundVendorEmail`; live Pub/Sub not deployed |
| E-tag / ESL live (§14 step 26) | 5% | 0.00 | Phase 7; Minew creds blocker |
| §14 full E2E integration gate | 10% | 0.45 | Leg verifies exist; no single 27-step gate passed |

**Explicitly out of this %:** location-first Phases 5–6, Phases 7–9 (AI/ESL), App Check, harness/agent-ops, physical shop-map/sign printing (Jake Korb).

---

## MVP done — exit criteria (checklist)

- [ ] **§14 E2E gate PASS** — full vendor→dispatcher→pickup (+ agreed email path) scripted verify green local + one prod run
- [ ] **Live email ingest operable** — Gmail watch/Pub/Sub configured; one real inbound message links to a delivery without manual workaround
- [ ] **Core regression green** — pickup, vendor, dispatcher, location Phase 4 release verifies PASS on prod after latest deploy
- [ ] **Combination scope honest** — ship atomic combo assign+release **or** document stub as explicitly out of MVP done
- [ ] **E-tag closed or waived** — live Minew demo **or** written Dan waiver that MVP done excludes live e-tags

---

## Fastest path to MVP (priority order)

| # | Action | Closes | Owner | Blocks daily loop? |
|---|--------|--------|-------|-------------------|
| 1 | Build + run **§14 E2E gate** (`verify:phase14-e2e` or equivalent) local + prod | E2E exit criterion | **In-repo** | No — highest-value internal work |
| 2 | **Dan GCP Gmail checklist** → deploy inbound CF + rules → reconnect OAuth | Live email criterion | **Dan** (GCP) + deploy | No for manual Condition 1; yes for automated evidence |
| 3 | **Combination release decision** — implement with placeholder IDs or waive in exit criteria | Combination honesty | **In-repo** + Jake for real IDs | No |
| 4 | **E-tag waiver** (recommended for speed) — document MVP excludes live ESL until Minew creds | E-tag criterion | **Dan** decision | No |

**Parallel while blocked on Dan:** item 1 (E2E gate) and item 3 (combo logic/waiver doc) — do not wait on Pub/Sub or Minew.

**Defer until after MVP done:** location-first Phases 5–6, Phase 7 ESL automation, Phase 8–9 AI, harness Phase 2 auto-gotcha, ESLint cleanup batches unrelated to exit criteria.

---

## Gap reference (ranked)

1. §14 full E2E gate not passed — **high**, in-repo
2. Live Gmail ingest (Pub/Sub + IAM + deploy) — **high**, Dan/external
3. Combination location release incomplete — **medium**, in-repo (real IDs: Jake Korb)
4. Live ESL / e-tag (step 26) — **medium** for narrative; **low** for core loop; Minew blocker
5. Physical shop map — **medium-low**; sign printing only; not core software loop

---

## Assessment history

| Date | % | Models | Notes |
|------|---|--------|-------|
| 2026-07-12 | 80 | Fable 82 + Grok 79 → confer | `work-verifier: f8d92887`; `confer: cc0c25e0` |

Re-assess when any exit criterion closes or a major phase ships.
