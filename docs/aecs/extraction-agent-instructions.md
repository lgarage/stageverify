# ACES Extraction Agent — Instructions

> **Status:** Parked until Dan triggers (expected: after StageVerify MVP is in line — live email ingest closed, §14 E2E residual done). Do **not** begin extraction work from this file without Dan's explicit "go".
> **Layer:** 2 (ACES dev memory). Not an alwaysApply rule; not part of the frozen live-harness surface (D-16).
> **Audience:** the future agent (any client — desktop, cloud) assigned to make ACES usable by anyone.
> **Authority:** Dan directive 2026-07-12 (this session). Where this file conflicts with live `.cursor/rules/`, live rules win until extraction begins.

---

## 1. Mission

Reason through — then, after Dan approves the reasoned design, build — a version of this harness that **anyone can install and use on Cursor**, that **learns over time from its own experience**, and that **starts every new adoption by extracting the user's intent**: end goal, purpose, design ideas, expected outcomes, working style, risk tolerances.

You are not porting a rules folder. You are productizing a governance layer. The deliverable order is:

1. **Reasoned design report** (this file § 4–8 are your brief) — reviewed by the adversarial agent until agreement (§ 3).
2. **Implementation plan** — phased, each phase independently shippable.
3. **Implementation** — only after Dan approves the plan.

## 2. What ACES is (read before reasoning)

Read in this order; do not skip:

| Source | Why |
|---|---|
| `docs/aecs/ACES-DESIGN-REPORT.md` — on PR #25 (`cursor/aces-design-report-d031`) at time of writing; check whether merged | Full system map — three layers, ladder, memory, learning loop |
| `aecs/README.md`, `docs/aecs-phase1-audit.md` + `docs/aecs/phase-2-plan.md` … `phase-5-plan.md` | What portability work already exists and what was deferred |
| `aecs/manifest.json`, `aecs/core/rules/*.template`, `aecs/installer/`, `aecs/updater/`, `aecs/release/OPERATOR-GUIDE.md` | A partial portable package already ships (installer/updater/export v0.2.0) — productize and scrub it; do not rebuild from zero. It is your starting point, not your product |
| `.cursor/rules/*.mdc` (live) | The real, battle-tested harness — StageVerify-coupled; your source material |
| `PROJECT_STATUS/DECISIONS.md`, `HARNESS_V1_FREEZE.md` | Governance DNA — the freeze's asymmetric rule and evidence bar are part of the product, not overhead |
| `PROJECT_STATUS/gotcha-map.json`, `LIBRARIAN_LESSONS.md`, `indexer-memory.json`; plus `PROJECT_STATUS/verifier-log.jsonl` + `scripts/gate-check.mjs` + `scripts/verifier-log.mjs` (D-28/D-29 — on PR #26, `cursor/harness-gate-evidence-6544`, at time of writing; check whether merged) | The learning loop's data shapes — what "learns over time" concretely means here |

Core identity (do not drift from this): **ACES is a governance layer that sits on top of Cursor's agent runtime.** It owns no model loop. Its distinctive value is *verified* work: risk tiers, evidence lines, fix-closure, cheap-model verification, human-gated learning promotion. Competing runtimes (Hermes-class self-improving agents, gateway products) auto-curate their own learning; ACES's evidence-gated learning is a deliberate differentiator for production code — keep it.

## 3. Model discipline — for YOU, the building agent (mandatory)

The harness you are extracting practices what it preaches. So do you, on every phase of this work:

| Role | Current model (2026-07) | Rule |
|---|---|---|
| Orchestrator + implementer (write code/docs) | **Composer 2.5 Fast** | Cheapest capable implementer. This WILL change — resolve "current cheap implementer" at build time from `model-gates.mdc` tier table; never assume this table is current |
| Cheap verifier lanes: ship, planning, repair, Q&A, stall-advisor, critical/adversarial reviewer (spec challenge, code review, devil's advocate) | **Grok 4.5 Fast** (`grok-4.5-fast-xhigh`, readonly Task) | Dispatch per lane per `model-gates.mdc` § Verification ladder — one Task per role per event. Loop until AGREE/PASS; the finder re-verifies fixes (fix-closure, D-04). Spec review BEFORE implementing; code review AFTER |
| Security gate | **Sonnet 4.6** — locked slug `claude-4.6-sonnet-medium-thinking` per `security-review-gate.mdc` (substitute + document only if the slug is unavailable in your environment) | Before push on any high-risk path (workflows, package scripts, installers that write files, anything touching auth/secrets) |
| Diagnostician (separate from security) | **Sonnet 4.6**, diagnose-only | Per `model-gates.mdc` § 2-fail rule: 2nd same-fingerprint fail → Grok stall-advisor first; Sonnet when still stuck. Never implements |
| Deep/work verification | **Fable 5** (readonly Task) | Fires per `model-gates.mdc` § Work Verifier triggers — Fable-authored spec phases with tripwires, Ship Verifier escalation, or Dan says "fable verify". Your implementation plan should propose which extraction phases carry Fable gates; Dan confirms |

Evidence lines (`ship-verifier:`, `planning-verifier:`, `qa-verifier:`, `repair-verifier:`, `stall-advisor:`, `critical-reviewer:`, `security-gate-id:`, `work-verifier:`, `fix-verified:` — task ids + model lines) are mandatory in every completion report; if the D-28 `verifier:log` tooling is merged, log every verdict there too. A review without a Task id = NOT RUN.

**Model names above are a snapshot, not a spec.** The extraction's design must treat model identity as configuration (§ 6); your own workflow must re-check the live tier table before dispatching.

## 4. The intake interview (the front door — design this first)

A new user's first session IS the product's first impression. Design a first-session protocol that:

- Runs when Layer-3 seed files are absent; **terminates itself** via a durable seed-complete marker (or removes itself). Never a forever-alwaysApply rule with a prose "skip if seeded" check.
- Asks, conversationally (not a form): **intent** ("what are you building?"), **end goal / definition of done**, **design ideas** and constraints, **expected outcomes** (what does the user expect the agent to produce, verify, never do), **risk map** ("what would be expensive or irreversible to break in YOUR stack?" → their ship-loop path table — the StageVerify answer is `firestore.rules`; an inventory app's answer might be payment code or DB migrations), **model access** ("which models does your subscription include?" → role→model mapping), **working style** (active vs away, time constraints, approval appetite).
- Writes the answers as generated Layer-3 memory: scope doc, roadmap seed, path-classified risk table, decision registry entries D-01…D-NN (so future sessions trust the answers instead of re-asking — the handoff-trust principle, D-13), orchestration profile.
- Re-runs incrementally: users' goals drift; provide a cheap "re-interview" command that diffs new answers against recorded decisions rather than starting over.

## 5. Learning that travels

"It learns over time through its own experience" must survive extraction. Reason through how each mechanism decouples from StageVerify:

| Mechanism | StageVerify coupling today | Extraction question |
|---|---|---|
| Outcome rows (brain repo) | Separate private repo, Windows paths | Per-install local outcomes file by default; opt-in remote |
| gotcha-map / lessons / indexer | StageVerify task vocabulary | Ship empty schemas + the promotion *rules*; content grows per install |
| Verifier calibration (`verifier-log.jsonl`, D-28 — PR #26 at time of writing) | Portable if merged (repo-relative script) | Include from day one — it is the evidence engine for the user's own freeze decisions |
| Estimate calibration | StageVerify script names | Generalize to task-type keys the intake seeds |
| Freeze / pain tickets (D-15/D-16) | Charter text | Ship the asymmetric rule as a template — it doubles as the public-contribution policy |

Principle: **ship the loops, not the memories.** A new install starts with empty stores and the same promotion gates Dan uses.

## 6. Model-agnostic by roles

The architecture is role-shaped: implementer, cheap verifier/adversary, security gate, deep verifier, diagnostician. Make model identity pure configuration:

- A single `role-models` mapping (filled by the intake interview) that every rule template references by role variable — finish the parameterization the templates started (`<ORCHESTRATOR_MODEL>` etc. exist; escalation copy still hardcodes Sonnet/Opus; live `model-gates.mdc` hardcodes Task slugs — that hardcoding must not survive into the portable core).
- Degradation policy: a user with one expensive model gets a functional single-model ladder with the verification *protocol* intact (verify loops still run; they're just not cheaper). Document the economics honestly.
- "Current cheap model is Composer 2.5" is true in 2026-07 and will be false later. The portable core must never encode a model name outside the mapping file.

## 7. Shareability watch-list (maintain even while parked)

Dan will not share this until after StageVerify is in line — but improvements keep landing. Know what to look for so the extraction stays cheap no matter how much the live harness evolves. **Never publishable** (scrub or exclude, every category, every time):

1. **Product facts** — StageVerify business logic, routes, roadmap, MVP economics, vendor/job vocabulary in rules, seeds, fixtures.
2. **NDA material** — anything Minew: names in guardrails are fine to *have* locally; the public core ships a generic NDA-guardrail template instead.
3. **Identity/infrastructure** — Firebase project IDs, gh-pages URLs, machine names, `C:\Projects\…` paths, test-account conventions, real person/shop names anywhere (including seed data and lessons files).
4. **Private history** — `cursor-agent-brain` data, `outcomes/*.jsonl` contents, `verifier-log.jsonl` rows, estimate logs, pain-log entries naming real events. Ship schemas, never rows.
5. **Git history** — the public artifact is a **new empty repo** seeded from a scrubbed export. Never flip this repo public; never trust a history rewrite.

**Ledger reconciliation (extraction-time only):** as your first task when triggered, walk every harness change since this file's date (git log on `.cursor/rules/`, `scripts/`, `PROJECT_STATUS/` schema files) and classify each as portable | project | mixed into `docs/aecs/shareability-ledger.md`. This is deliberately NOT a standing pre-extraction habit for live agents — a new recurring workflow would face D-16's addition bar and Critical Reviewer; the watch-list above plus extraction-time reconciliation achieves the same end without touching the frozen surface.

## 8. Constraints and success criteria

**Constraints:** Cursor-first (this is a Cursor governance layer; other-IDE ports are out of scope for v1). D-17 stands — none of this work displaces StageVerify delivery until Dan triggers it. D-15 stands — every component you propose must justify itself against the 80/20 complexity tax; prefer deleting live-harness complexity while porting over faithfully copying it. The freeze's evidence discipline applies to the extraction itself: claims about what works require verify scripts or test evidence, not narration.

**The extraction is right when:**

1. A stranger with Cursor + one capable model can install it and reach a governed first ship (interview → seeded memory → tiered ship loop → evidence-lined completion report) without reading StageVerify's history.
2. Their harness learns: by week two, their own gotchas, lessons, calibration rows, and pain tickets exist in their stores — none of Dan's.
3. Nothing in categories 1–5 of § 7 appears anywhere in the public artifact (verify mechanically — grep lists, not vibes).
4. The role→model mapping is the single source of truth for model identity: no model names in rule prose outside it (mechanical dispatch surfaces like Task `subagent_type` plumbing may reference it, never bypass it). Swapping the cheap implementer when Composer 2.5 is superseded is a one-line mapping change.
5. Dan's live harness keeps working untouched — extraction reads from this repo; it never rewrites it.

---

*Dan-directed design brief, 2026-07-12; Grok-reviewed. When extraction begins, Composer-class implementers write all files (D-12); verifiers verify. Supersedes nothing; parked pending Dan's trigger.*
