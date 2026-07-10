# Decision Registry

## How this file works
- Active section capped at ~40 decision lines; one line per decision.
- Format: `D-NN (YYYY-MM-DD) [harness|product]: <decision> — because <compressed why>.`
- Stable IDs — never renumber. Superseded → `PROJECT_STATUS/DECISIONS_ARCHIVE.md` with `superseded-by D-NN`; never delete.
- `[harness]` = agent/orchestration; `[product]` = StageVerify behavior/architecture.
- Record new decisions in the **same commit** as the work that implements them.

## Active decisions

D-01 (2026-07-09) [harness]: Two-tier ship model — fast-safe (`src/`, `public/`, verify scripts, docs, PROJECT_STATUS, routine service logic) build/commit/push/deploy without approval; high-risk (auth, `firestore.rules`, CF write paths, secrets, billing, data deletion, schema migrations, deploy config, auth/route-guard files under `src/`, root `package.json` deploy wiring) require explicit Dan approval before implementation **and** deploy — because bad backend deploys are not cheaply revertible like a bundle; ambiguous tier → classify high-risk and ask.
D-02 (2026-07-09) [harness]: Tiered verification ladder — Grok 4.5 Fast = post-ship ship-verifier (scope/correctness) and pre-decision critical reviewer (plans/architecture); Sonnet 4.6 = mandatory security gate (unchanged); Fable 5 = work verifier for tier-3/phase-boundary work only — because each check should use the cheapest capable model.
D-03 (2026-07-09) [harness]: Evidence standard — every review/verification claim requires subagent Task ID + model line in the completion report; missing evidence = NOT RUN — because reviews were previously claimed but never executed.
D-04 (2026-07-09) [harness]: Universal fix-closure — whichever model reported an issue re-verifies the fix before closure — because fixes were being closed without the reporter confirming them.
D-05 (2026-07-09) [harness]: Lessons compression — lessons files keep only compressed reusable rules that change future behavior; specific incidents get distilled then archived — because per-incident logs are context bloat.
D-06 (2026-07-09) [harness]: Trim always-applied rules in place; defer flipping time-awareness / parallel-agent-strategy to on-demand until attachment reliability is proven — because heuristic attachment risks silent behavioral regression (Grok review finding).
D-07 (2026-07-09) [harness]: Away/overnight workflow follows the same ladder — per-item ship verification, queue-time high-risk `danApproved` schema check, mandatory verifier report lines — because away batches must not bypass harness gates.
D-08 (2026-07-09) [harness]: Decision registry + handoff protocol — decisions recorded same-commit; "prepare for new conv" flushes in-flight state; new conversations bootstrap from `CURRENT_STATE.md` + this file — because handoff prompts should never need to be hand-written.
D-09 (2026-07-08) [product]: Vendor PIN is job-scoped (D14) — post-PIN UI shows only that job's spots/deliveries; overflow suggestions = empty spots unassigned to any company/job only — because cross-job visibility causes physical staging mix-ups (location-first spec § Job-scoped vendor PIN).
D-10 (2026-07-09) [product]: Printed QR strategy is static permanent location signs (`#/s?loc={code}`); occupancy-dynamic QR-flip rejected; `qr-routing`, `zone-lookup`, `encode-qr` dossier § refreshed — legacy dispatcher zone e-tags still emit `#/receive?` / `#/pickup?` until Phase 3 role-aware resolver ships — because location-first signs must never change when occupancy changes.
D-11 (2026-07-09) [product]: Canonical vendor UI is `ReceivingPage` at `/#/receive` only; legacy `/#/` and `/#/checkin/:id` (plus compact `#/r?`) redirect there — because duplicated vendor UIs caused scan/routing drift.
D-12 (2026-07-09) [harness]: Fable 5 never implements — all file changes go to Composer 2.5; Fable verifies the result and gates ship (ship only after Fable confirms correct, with fixes looping back to Composer per D-04) — because implementation on the expensive model wastes cost and blurs the verify role.
D-13 (2026-07-09) [harness]: Handoff bootstrap is trust-based — new conversations read CURRENT_STATE.md + DECISIONS.md only; no transcript mining, no re-verifying recorded verdicts (handoff flush must record verdict + commit hash per item) — because re-deriving verified state from primary sources burned 37% of a session's tokens and 7 minutes.
