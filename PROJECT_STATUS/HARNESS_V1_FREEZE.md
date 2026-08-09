# Harness V1 Freeze (D-16, 2026-07-09)

Charter after adversarial review rounds 1–5. StageVerify MVP takes priority over new orchestration layers.

## Frozen surface (V1 complete)

Two-tier ship model · verification ladder + fix-closure + repair loop + planning verify loop + Q&A verify loop + doc drift validate · security gate · away queue + protocol · decision registry + handoff · evidence standard · scope discipline · product guardrails · parallel-agent strategy · completion-report contract · meta-review rounds themselves.

## Asymmetric rule

**Deletions/compressions:** always legal, no ticket. **Additions** require: same friction logged ≥2× (named, dated), OR security incident, OR production incident, OR measured bottleneck, OR real customer exposing a missing capability. Proposer carries the burden (D-15).

## Reopening IS justified by

Repeated logged pain (2×); safety/security incident; mobile probe data (repeated "wanted to act, couldn't" while driving); StageVerify reaching real vendor traffic.

## Reopening is NOT justified by

Elegance/symmetry/"while we're in there"; new model releases alone; hypothetical scale; ideas from articles/videos; one-off annoyance or single batch halt; harness ideas during drives (log them; they face the 2× bar).

## Pain log (append below)

Voice-cheap — **"log pain: <what you wanted and couldn't do>"** in any channel → one dated line here. No form, no ceremony.

- 2026-07-09: first new-conv bootstrap re-derived tier and misclassified push ingest (Gmail/Pub/Sub, high-risk) as fast-safe → fixed same night: flush now records tiers; bootstrap defaults unrecorded to high-risk.
- 2026-07-10: consecutive same-failure stall — Composer retried identical verify/build fixes twice without new hypotheses; wanted cheap Grok pivot before Sonnet (D-19).
- 2026-07-11: Dan repair requests — Composer closed fixes without higher-tier verifier on repair scope/result; wanted automatic repair loop with fix-closure (D-20).
- 2026-07-11: planning questions ("what's next", "what else can be worked on") — Composer presented first-draft ranked options without Grok cross-check against CURRENT_STATE/away:next; omitted recent ships and invented away IDs; wanted mandatory planning verify loop before present (D-21).
- 2026-07-11: On phone, wanted authoritative mobile-safe next; away-list had stale batch `instructions` on empty `sequence` and no capability filter — queue hygiene Phase 1a (`away:sync`, normalize on ship).
- 2026-07-11: Dan wanted Grok conferral on all non-trivial Q&A answers (not only planning) on desktop PC and cloud; status/terminology answers needed cross-check — Q&A verify loop (D-22).
- 2026-07-11: Planning agents cited stale location-first Phase Tracker + roadmap vs CURRENT_STATE after Phase 4 prod verify closed — doc drift validate in `away:validate` / `away:sync` (D-23).
- 2026-07-12: Dan-directed reopen (owner authority, not 2× measured pain): mechanize evidence gates (CI gate-check) + verifier calibration log (D-28) — verifier-log exists to produce future freeze measurements.
- 2026-07-12: Dan-directed (owner authority): verifier loops felt hierarchical — author silently adopted every verifier finding; wanted peer deliberation with agreement before implementation (D-30).
- 2026-07-12: MEMORY.md grew past its ≤70 hot-tier cap (75 lines) and the `away:validate` WARN was ignored across sessions — wanted a mechanical stop plus in-session compression, not advisory noise; warn→FAIL + condensed router (D-31).
- 2026-07-12: new rules kept opting into platform parity one by one (per-rule D-20 clauses in D-21/D-22/D-23) — Dan wanted parity **assumed** for every new rule across desktop PC, mobile Cursor, and cloud VM, with only physically-impossible exceptions declared (D-32).
- 2026-07-12: question-triggered verifier loops risked one-way verdicts and verifier-authored text reaching Dan — wanted mandatory peer deliberation on every qualifier/verifier call with the orchestrating agent (Composer) authoring the final note in one consistent voice (D-33).
- 2026-07-12: routing rules read as cost-minimization ("Billing:" framing) — Dan restated the purpose: trust is the goal, cost is the constraint; cheap output without verifier agreement is pointless; worker+verifier must agree before the orchestrator replies, on every client (D-34).
- 2026-07-13: Dan had to declare "I'm on my phone/mobile" for the system to behave, and D-27 trigger phrases treated device mentions as routing signals — wanted mechanical environment detection (PC vs cloud VM) with device statements as ergonomic context only (D-35).
- 2026-07-13: direct work directives to Composer went straight to implementation (announce-and-go) with solution-level Grok review only post-ship — Dan wanted propose → deliberate → agree BEFORE building, not verification after the fact (D-36; Dan-directed reopen).
- 2026-07-17: orchestrating agent (Fable) edited rule files directly during the 2026-07-12/13 governance sessions instead of dispatching Composer — Dan directed: work is Composer's; the dispatching agent verifies the returned work (D-37, additive only).
- 2026-07-18: security gate slug `claude-4.6-sonnet-medium-thinking` not dispatchable on cloud VM (live probe) — gate would return NOT RUN on any cloud T3 ship; 2nd slug drift after Grok 2026-07-13 — locked allowlist with proven fallback (D-38); Sonnet 5 deferred behind calibration.
- 2026-07-24: Dan-directed every-edit ≥97% confidence before any file write (D-47 widens D-46 from substantive-only to all repo writes; classify + agreed Critical clarifications on scope persistence and verifier-lane vs conf-bar separation).
- 2026-07-24: Dan-directed reopen (owner authority): print-label worker implemented then ran Solution Verifier (2nd deferral incident — Agree after edit); D-48 locks PASS + evidence before **first repo write** in scope when D-36 applies (closes docs-first dodge); workers cannot defer Agree to parent (Dan 2026-07-24).
- 2026-07-24: Dan-directed reopen (owner authority): same task scope hit **3 consecutive implement+verify fails** — wanted automatic Grok↔Sonnet Agree on root cause + fix plan, then Grok implements stuck scope once, then Composer default implementer again (D-50; not gated on Dan saying "escalate").
- 2026-07-24: Dan-directed reopen (owner authority): Catch-all delivery top-bar button missing after UI ship despite build + verify pass — wanted mandatory before/after screenshot compare on every visible UI edit (chrome regressions), not build-only (D-51; complements D-42/D-45).
- 2026-08-05: Dan-directed reopen (owner authority): pre-push D-38 security gate alone insufficient for high-risk CF/auth/rules — wanted mandatory Sonnet instruction packet before Composer codes + Sonnet verify loop (code + Playwright acceptance) blocking before commit (D-60).
- 2026-08-05: Dan-directed reopen (owner authority): after agent actions Dan often could not tell if work was finished or whether he needed to do anything — wanted mandatory DONE + short what-I-did + Your action footer (D-61).
- 2026-08-05: Dan-directed reopen (owner authority): after D-50 Grok implement still failing on same scope, wanted bounded post-D-50 retry (max 2 Agree→Grok rounds) before STOP/escalate — not unbounded Composer or Grok spin (D-62).
- 2026-08-08: Dan-directed reopen (owner authority) + prior availability pain (2026-07-18): D-38/D-60 Sonnet-required gates blocked on unavailable Sonnet 4.6 Task slugs — promote active allowlist to Sonnet 5 (`claude-sonnet-5-thinking-high`); calibration + `ALLOWED_GATE_MODELS` same commit; Composer/Sol/Grok builder routing unchanged.
- 2026-08-08: Dan-directed reopen (owner authority): UI/UX default **Sol** primary + readability DoD — Sol Medium preferred (`gpt-5.6-sol-medium` canonical); Task subagent allowlist rejects Medium → automated Task dispatch escalates to High; Grok verifier + SSOT `ui-model-routing.json` v2 (D-63); non-UI Composer unchanged; Sonnet gates unchanged.
- 2026-08-08: Dan-directed reopen (owner authority) + cost-audit pain: Pro+ Other Models burned by automatic multi-Grok stacks on routine T1 UI + Sol High Task tax + Ship FAIL loops on evidence-format gaps — Balanced trim D-65 (lane table; Sol visual-judgment only; conditional Solution/Build/UI-PW/Ship; Q&A consequential-only; `ship-evidence-preflight.mjs` addition justified by D-54 evidence-gap double-Ship pain logged prior). PROTECTED D-38/D-60/mechanical/D-50 unchanged.
- 2026-08-08: Dan-directed reopen (owner authority): terminal status ambiguity (finished vs wait-on-Dan vs failed vs partial unfinished scope) — D-66 four-status block amends D-61; SSOT `done-signal.mdc`; shell notifications ≠ authoritative status.
- 2026-08-09: Dan-directed reopen (owner authority): agents still needed occasional “follow the 97 rule” reminders — pre-edit-only framing let investigate/verify/DONE and subagent-inheritance miss D-47; harden universal alwaysApply SSOT + completion/honesty/subagent bars (D-69).
- 2026-08-09: Dan-directed reopen (owner authority): agents burned wall-clock/model cost on repeated measurement timeouts, mistaken PIN autosubmit waits, and low-value verify/deploy poll loops — wanted in-run Timekeeper (advise-only hooks + rule) without weakening D-38/D-60/D-50 (D-72).
- 2026-08-09: Dan-directed reopen (owner authority): product/fix/deploy jobs closed with automated verify PASS but no Dan-facing real-user procedure — wanted mandatory **MANUAL TEST FOR DAN** in the completion report before DONE/ARCHIVE (D-78).
- 2026-08-09: Dan-directed reopen (owner authority): high-risk/security-sensitive work needed mandatory independent multi-model iteration — Sonnet 5 pre-review → builder → Grok adversarial critical review (iterate) → Sonnet 5 final verify → D-38, with fail-closed behavior and unchanged CF/rules deploy approval (D-60 amend).

## Deferred designs (reviewed 2026-07-09, rounds 1-5; retrievable via pain ticket)

Mission schema/boundary contracts · mobile Class 2/3 approval machinery + deny-list script + credential-stripped mobile env · skip-and-flag batch runner · phone-call voice agent · dashboards · event-driven digests · state-file consolidation · completion-report collapse (a deletion — legal anytime, deferred only for care).

## Next milestone

Location-first Phase 4 complete → printed signs → vendor pilot on one real job.
