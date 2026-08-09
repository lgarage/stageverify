# Lane C C3 — Reusable Vendor Field Learning Plan

> **Future C3 work must read this document first and then verify it against current `PROJECT_STATUS/DECISIONS.md` and current `main`. If this document conflicts with a newer authoritative decision, the newer decision wins.**

**Status:** C3-A COMPLETE 2026-08-09 — D-59 #7/#8 amend authoritative. Architecture handoff from the C3 design conversation (Composer + Grok Critical/Q&A).  
**Baseline main tip at design:** `f511fb41` (re-verify against tip at implementation time).  
**Related:** D-56, D-57, D-58, D-59, D-68, D-75; `docs/training-note-ignore-spec.md`; Lane C C1/C2 LIVE.

---

## Status table (SSOT for phase progress)

| Phase | Status |
| ----- | ------ |
| **C3-A** | **COMPLETE** — D-59 #7/#8 amend + threshold/invariants authoritative in `PROJECT_STATUS/DECISIONS.md` (2026-08-09) |
| **C3-B** | **COMPLETE / LIVE** — Johnstone PO grid-bleed + INVOICE banner; CF syncInboundGmail + reparseVendorInvoiceImportCallable deployed |
| **C3-C** | not started |
| **C3-D** | not started |
| **C3-E** | not started |
| **C3-F** | not started |

**NEXT C3 JOB:** **C3-C** — collect/index verified C2 examples (no parse effect). Do **not** start C3-D/E/F in a C3-C conversation. C3-B engineering complete — CF deploy of parser still needs Dan approval.

---

## 1. Purpose

**C2** corrects the **CURRENT** import only (explicit confirmation, ORIGINAL vs CURRENT preserved, durable audit). Future invoices of the same vendor/format do **not** learn from that correction today.

**C3** is **reusable learning** across future matching invoices: repeated **verified** Invoice Review corrections may produce narrowly scoped, audited, reversible extraction lessons so future invoices of the same type parse more accurately with less human review.

Concrete example:

1. Johnstone invoice parser misses Customer PO.
2. Dispatcher uses Invoice Review chat / C2 and confirms `Customer PO = 2205 EARLY`.
3. Today: that import is fixed; reparse preserves the correction; **future** Johnstone invoices do not learn.
4. Desired C3: after enough consistent verified examples + Manager/Admin activation, future matching Johnstone invoices can fill an empty Customer PO from document evidence near approved anchors.

**Hard purpose constraint:** C3 must **not** make one correction automatically become a global rule. One verified correction = evidence example only.

---

## 2. Relationship to prior Fable work

### Sources

- Fable 5 war-game agent `8f7e934d-2920-45f7-aec1-99e5d758d354` (2026-08-03)
- Spec: `docs/training-note-ignore-spec.md` (v1.0)
- Decisions: **D-56** (AI shadow + GCS playbooks), **D-57** (Training Admin + Save lesson), **D-58** (document ignore fingerprints), **D-59** (hardening + Dan’s 12 decisions)
- Lane C addendum on the training-note spec (2026-08-09): C1/C2 may ship without amending #7/#8; **C3 blocked until amend**; P8 `fulfillment_mapping` stays separate

### What Fable proved

- Lane A (GCS playbook prose) + Lane B (fingerprint ignore) are **effect-contained**: note text cannot delete/approve/mutate deliveries/jobs/items.
- Still **unsafe to generalize structured learning** without product decisions → verdict **REQUIRES PRODUCT DECISIONS BEFORE SPECIFICATION** → D-59.
- P1–P7 hardened Lane B (manager activate, sender pin, never-unknown, strong-invoice-signal guard, audit stream, circuit breaker, redaction preview, 90-day raw-note audit).
- **P8 structured-lesson engine deferred**; when it arrives, original MVP category was **fulfillment-method mapping only**.

### Failure modes Fable identified (Unsafe #1–#10)

Armable `unknown` fingerprints · no sender scope · one-step dispatcher create-and-activate · teach-chat intent regex misfire · loose credit dismiss fallback · client/server fingerprint drift · bypassable redaction · prompt text reaching Gemini (shadow-contained) · client writes to `deliveries`/`items` · legacy `parserFormatId` guess from vendor-key substrings.

### Safeguards that still apply to C3

| Safeguard | Source | C3 implication |
| --------- | ------ | -------------- |
| Manager/Admin activation | Dan #1 | Dispatcher proposes / evidence accumulates; **activation** is Manager or Admin — not one-step auto-activate from a correction |
| Fail closed on unknown | Dan #4 | Never arm lessons for `unknown` vendor or `unknown` `parserFormatId` |
| Sender scoping | Dan #5 | Lessons pin sender email domain(s); no match without domain pin |
| Reversible / audited lifecycle | Dan #10 | proposed → active → suspended/rejected/archived; soft-delete; immutable audit |
| No uncontrolled generalization | Fable + D-59 | Narrow scope keys; no cross-vendor wildcards |
| No arbitrary note→rule conversion | Dan #8 / trust boundary | Notes are data; C3 promotion is **deterministic from verified C2 audits**, not free-form note→LLM→rule |
| Circuit-breaker concept | Dan #3 | Extraction false-positive breaker (recommended: 2 undos of lesson-applied values → auto-suspend) |
| **Lane C ≠ Lane B effect** | Architecture | Extraction lessons must **NOT** inherit document-ignore skip semantics; never auto-reject/skip review because a field lesson matched |

### What Fable intentionally deferred

- P8 general structured interpretation engine
- Layout / semantic fingerprinting (spec §29 #7)
- Shadow mode for ignore rules (Dan #2 — ignore goes live on activate; shadow may be reconsidered for structured lessons in P8’s own approval)
- Promoting Lane A `aiShadowParse` to decision-driving (requires separate war-game)
- DMARC / Authentication-Results sender hardening
- away-137 write-boundary on `deliveries`/`items` (orthogonal follow-up)

### What advanced since Fable (must not be ignored)

- **C1/C2 LIVE:** verified allowlisted field corrections with `vendorInvoiceFieldCorrections` audit + `fieldCorrectionLog` + evidence classification (`document_evidence` vs `dispatcher_assertion`).
- **D-75 CLEANUP/SPLIT-lite:** `confidenceScore` stays parse diagnostic; CURRENT readiness is rule-based; stale confidence/HRR vetoes may skip only after verified C2 matches CURRENT.
- Named Admin / Manager roles exist for activation authority (prefer role-gated CF auth over shared training Admin password for C3 activation).

### Explicit bans from training-note spec that C3 must address via decision amend

Spec §7 previously rejected at schema level: “field mapping beyond fulfillment”, “vendor-layout patterns”, “parser confidence adjustment”. C3 **requires an explicit D-59 amend** that lifts field mapping **only** for the three C2 header fields — not a silent parallel system.

---

## 3. C2 → C3 gap

### C2 (LIVE — D-68)

| Property | Behavior |
| -------- | -------- |
| Scope | **Import-scoped** only |
| Trigger | Chat propose → explicit Apply / unambiguous confirmation |
| Allowlist | `customerPoOrReference`, `vendorOrderNumber`, `vendorInvoiceNumber` |
| Truth | CURRENT `parsedHeader` updated; one-time `originalParsedHeader` / `originalParseWarnings` |
| Audit | `vendorInvoiceFieldCorrections` + import `fieldCorrectionLog` |
| Reparse | Parser base → re-apply `fieldCorrectionLog` (C2 preserved) |
| Learning | **None** — never ignore/playbook/reusable knowledge |

### C3 (not started)

| Property | Behavior |
| -------- | -------- |
| Scope | **Cross-import**, vendor/format/sender/anchor scoped |
| Input | Verified C2 audits as **examples** |
| Output | Approved reusable **extraction lessons** |
| Apply | Deterministic post-parse overlay on **future** matching invoices |
| Training | **Not** implicit on C2 Apply — separate promotion + Manager/Admin activation |

### Gap statement

C2 fixes *this* invoice. C3 needs a separate, fail-closed store and lifecycle so *future* matching invoices can benefit — without turning Apply into training, without raising parse confidence by fiat, and without poisoning other vendors/formats.

---

## 4. D-59 amendment

### Authority status

**AUTHORITATIVE (C3-A COMPLETE — 2026-08-09).**

Landed in `PROJECT_STATUS/DECISIONS.md` **D-59** (amended C3-A). Exact final wording:

### Final D-59 #7 wording (authoritative)

> **(7) amended C3-A:** Structured reusable-lesson categories are allowlisted and fail-closed. Allowed categories:
>
> 1. `fulfillment_mapping` — deferred to P8 (original intent unchanged).
> 2. `header_field_extraction` — Lane C / C3 only; initially limited to exactly:
>    - `customerPoOrReference`
>    - `vendorOrderNumber`
>    - `vendorInvoiceNumber`
>
> This narrowly lifts the prior “field mapping beyond fulfillment” restriction **solely** for those three fields. Still prohibited unless separately approved: document classification overrides, normalization mappings, review-routing rules, parser confidence adjustment as a lesson effect, general-purpose vendor-layout / semantic interpretation engines, cross-vendor wildcard lessons, auto-approve, delivery/job/item mutation, and any non-enumerated lesson category.

### Final D-59 #8 wording (authoritative)

> **(8) amended C3-A:** A general-purpose structured interpretation engine remains deferred (P8 for fulfillment; Lane A playbook prose stays tips-only). **Narrow C3 carve-out only:** verified C2 correction evidence → candidate example → proposed reusable lesson → Manager/Admin activation → active deterministic extraction overlay. Does **not** authorize arbitrary note → LLM → reusable rule behavior. Any future model-interpreted reusable lesson system requires a separate product decision, Fable adversarial war-game, and explicit approval.

### Must remain true after amend

- `fulfillment_mapping` remains **separate / deferred to P8**
- No general-purpose structured interpretation engine
- No arbitrary note→LLM→rule system
- No parser confidence adjustment as a lesson effect
- No cross-vendor wildcard rules
- No auto-approve
- No delivery/job/item mutation
- Lane B document-ignore safeguards **not weakened**

### Amend packet extras (record with C3-A, not soft implication)

- CF-only writes to lesson/example collections
- Retention/TTL appropriate for examples containing PO/order/invoice identifiers
- Sender-domain scope; never-unknown vendor/format
- Extraction false-positive circuit breaker
- C2 CURRENT corrections always win over learned overlays on the same import

---

## 5. Evidence lifecycle

```
1 verified C2 correction
  → EXAMPLE only (no parse effect)

≥ 3 consistent document_evidence examples in the same scope
  → lesson may become PROPOSED

PROPOSED
  → no parse effect

Manager/Admin activation
  → ACTIVE (overlay eligible)

Other states: suspended | rejected | archived
```

### Policy notes (not mathematical confidence)

- **“3 examples” is a product policy threshold, not mathematically proven confidence.** **LOCKED at C3-A (v1):** ≥3 consistent `document_evidence` examples in the same allowed scope may promote to PROPOSED; changing this number later requires a new product decision.
- **`dispatcher_assertion`-only examples must not satisfy the threshold by themselves.** Counting examples for the threshold must be `document_evidence` (assertions may attach as supplemental evidence only).
- Contradictory evidence in the same scope **blocks promotion** and should suspend a proposed/active lesson pending review.
- One bad human correction remains **only an example** — never auto-activates.

### Recommended activation authority

Manager or Admin via CF auth (align with Dan #1 spirit). Do not rely on the shared Invoice Training Admin password as the sole C3 activation gate.

---

## 6. Rule scoping

### v1 required scope keys

| Key | Notes |
| --- | ----- |
| `vendorKey` | Server-sanitized; never `unknown-vendor` |
| `parserFormatId` | `johnstone` \| `first_supply` \| `generic` — never `unknown` |
| `field` | One of the three allowlisted header fields |
| Sender domain | ≥1 pinned domain from teaching/evidence emails (header From), max policy aligned with Lane B (≤5) |
| Allowlisted label/text anchors | Exact allowlisted literals (e.g. `CUSTOMER P/O`, `CUSTOMER PO`) — fail-closed schema; not free-form “nearby text” ML |

### Same-format signal (v1)

Two invoices are treated as the same learnable format when they share:

- same sanitized `vendorKey`
- same `parserFormatId` (from `routeInvoiceFormat` / stored import)
- sender domain ∈ lesson’s pinned domains
- required allowlisted anchors present in extracted text

Today’s router/fingerprint stack is **enough for v1** with anchors; do **not** invent layout hashing as a blocker for C3-C/D/E.

### Must not rely solely on

- Absolute PDF coordinates / page geometry as the only locator

### Optional later (separate design)

- Document/layout family fingerprint (Fable known limitation §29 #7 — not v1)

### Fail closed on

- Unknown vendor
- Unknown format
- Scope mismatch (wrong field, missing anchors, sender not pinned)
- Empty or non-allowlisted anchors

---

## 7. Proposed data model

**Prefer extending the existing training/learning *philosophy* (Lane B lifecycle patterns) without overloading Lane B’s skip store or Lane A’s GCS prose.**

### Collection: lessons (flexible name)

Suggested name: `vendorInvoiceFieldLessons`  
*(Naming flexible — keep effect clear: extraction lesson, not ignore rule.)*

Suggested doc id pattern (flexible):

`{vendorKey}__{parserFormatId}__{field}__{anchorKey}`

Important concepts / fields:

| Concept | Intent |
| ------- | ------ |
| `category` | `"header_field_extraction"` |
| `vendorKey` | Scope |
| `parserFormatId` | Scope |
| `field` | One of three allowlisted keys |
| `senderDomains` | Pin list |
| `documentTypeScope` | Extraction scope (e.g. invoice); **disjoint** from ignore arming rules — do not reuse ignore “invoice unarmable” semantics blindly |
| `labelAnchors` | Allowlisted literal tokens |
| Deterministic `pattern.kind` | e.g. `label_anchor_capture` \| `fill_when_empty_from_bounded_token` — **no absolute PDF coords** |
| `status` | `proposed` \| `active` \| `suspended` \| `rejected` \| `archived` |
| Evidence | `evidenceExampleIds[]` / `evidenceCount` |
| Reliability | `successCount` / `failCount` / `lastFailedAt` |
| Activation metadata | `proposedBy`/`proposedAt`, `activatedBy`/`activatedAt` |
| Suspension/archive metadata | `disabledBy`/`disabledAt`/`disabledReason`, `archivedBy`/`archivedAt` |
| Version / match | `version`, `matchCount`, `lastMatchedAt`, `lastMatchImportId` |

### Collection: examples / evidence (flexible name)

Suggested: `vendorInvoiceFieldLessonExamples` (top-level or subcollection).

| Concept | Intent |
| ------- | ------ |
| Link to C2 | `correctionId`, `vendorInvoiceImportId` |
| Evidence class | `document_evidence` \| `dispatcher_assertion` |
| Span / citation | Optional copy of C2 evidence span fields |
| Scope denorm | vendorKey, parserFormatId, field, senderDomain, anchors observed |
| Timestamps / actor | When confirmed, by whom |

**Examples are evidence, not rules.** An example never affects parse by itself.

### Do not use as authoritative C3 store

| Store | Why not |
| ----- | ------- |
| GCS vendor playbooks (Lane A) | Free-form prose; redacts PO/PII; shadow-only; non-authoritative |
| `vendorInvoiceIgnoreRules` (Lane B) | Different effect (review-queue skip); invoice-type arming rules differ |
| `trainingNoteAudit` | 90-day raw-note **audit**, not a reusable learning store |

---

## 8. Parser integration

### Preferred v1 pipeline

```
specialized parser (johnstone / first_supply / generic)
  → merge
  → deterministic post-extraction overlay (active C3 lessons only)
  → (eligibility / D-75 readiness on CURRENT)
```

### Active lesson may

- **Fill an EMPTY** allowlisted field
- Use **bounded document evidence** near approved anchors (token boundary rules aligned with C2 `classifyCorrectionEvidence` spirit)
- Optionally **rank candidates** later (C3-F) for review UI

### Active lesson must NOT

- Blindly overwrite a non-empty parser value
- Run an LLM over all historical examples on every invoice
- Mutate unrelated fields
- Auto-approve the import
- Raise `confidenceScore` merely because the lesson exists

### Why post-extraction overlay (not pre-parser hints) for v1

- Safest / most token-efficient
- Keeps specialized parsers as source of ORIGINAL parse
- Easy to order with C2 log precedence
- Avoids poisoning the base parse path before merge

---

## 9. C2 precedence / reparse ordering

**Authoritative order for every parse/reparse:**

```
1) specialized parser (+ merge)     → base / ORIGINAL-capable snapshot rules unchanged
2) active C3 overlay                → fill-empty only when scope matches
3) C2 fieldCorrectionLog LAST       → confirmed CURRENT corrections always win
```

Invariants:

- C2 CURRENT correction **always wins** for that import.
- Reparse must **not** overwrite a confirmed C2 value with a learned lesson.
- `originalParsedHeader` remains the pre-human-correction snapshot semantics already established by C2 (do not redefine ORIGINAL as “pre-C3”).

---

## 10. Confidence / readiness rules (D-75)

Preserve **CLEANUP / SPLIT-lite**:

| Rule | Behavior |
| ---- | -------- |
| `confidenceScore` | Remains an **honest parse diagnostic** |
| Lesson exists | **Do not** raise confidence simply because a lesson exists |
| Operational readiness | Remains **CURRENT-state / rule-based** (`computeAutoImportEligibility` and successors) |
| Learned extraction helps | May complete CURRENT empty fields → readiness can improve via normal rules |
| Fabricated certainty | **Forbidden** — matching a lesson ≠ inventing high parser confidence |

Stale-veto skip after verified C2 (confidence&lt;85 / sticky HRR) remains a **C2/D-75** concern; C3 must not create a second 0–100 readiness score or lower the 85 threshold as a side effect.

---

## 11. Failure / rollback

| Threat | Protection |
| ------ | ---------- |
| Contradictory evidence | Blocks promotion; suspend proposed/active |
| One bad human correction | Remains example only; cannot activate alone |
| Lesson applied wrong value | Human C2 correction away from lesson-applied value increments FP counter |
| Vendor template drift | Rising failCount / corrective evidence → suspend → review |
| Over-broad pattern | Narrow scope keys + allowlisted anchors + fail closed |
| Sender spoof / wrong vendor | Sender-domain pin; never-unknown; no cross-vendor wildcards (spoof residual acknowledged as Lane B §29 #1 class) |
| Bad active lesson in prod | Manager/Admin instant disable; soft archive |

### Circuit breaker (recommended default — mark as recommendation)

**Recommendation (not final until Dan locks at C3-D):**  
**2 human corrections that undo a lesson-applied value** (same lesson id) → **auto-suspend** + alert + require re-review before reactivation.

Symmetric in spirit to Dan #3 (ignore: 2 admin re-opens → auto-disable), but counted on **extraction undos**, not ignore re-opens.

### Lifecycle ops

- Suspend / reject / archive without hard delete as normal lifecycle
- Immutable lesson audit stream (mirror patterns from `ignoreRuleAuditEvents`)
- Operational rollback without deploy: disable lesson instantly

---

## 12. Security / privacy

- **Server-authoritative / CF-only writes** to lesson + example collections; Firestore rules deny client writes
- **No client writes** to reusable lessons
- **Sender-domain pinning** required for activation/match
- **No cross-vendor leakage** (no wildcards, no “all vendors”)
- Examples/lessons may retain **PO / order / invoice identifiers** — unlike Lane A playbook redaction — so require **retention/TTL + access control** appropriate to that sensitivity; do not dump full values into unstructured logs beyond current policy
- **Audit** activation, match, suspend, archive, breaker trips
- Validation failures **fail closed** (no lesson saved/activated; import stays reviewable)
- Do not feed free-form training notes into a model to invent extraction rules in v1

---

## 13. Token / cost strategy

- **Deterministic rules preferred** for active overlay
- **Do not** inject all historical examples into an LLM for every invoice
- Use AI only where it materially helps (C1 explain/propose remains separate; C3 apply path is model-free)
- GCS playbooks remain **non-authoritative tips** for shadow parse only (D-56/D-57)
- Prefer fixing universal patterns in specialized parsers (C3-B) over storing redundant lessons

---

## 14. Base parser vs C3

**Architecture conclusion: BOTH, but ordered.**

| Situation | Action |
| --------- | ------ |
| Pattern is **universally valid** for a vendor/document shape | **Fix the base specialized parser first** (e.g. `parseJohnstoneInvoice`) |
| Pattern is **residual / vendor-format-specific / unstable** across template revisions | Use **C3 reusable lessons** after evidence + activation |
| Obvious Johnstone regex / extract bug | **Do not create C3 to paper over it** |

Johnstone already has multi-path PO extraction (`pickPoValue`, tabular/stacked/labeled, `sanitizePoFromGridBleed`). Live misses (e.g. `2205 EARLY` style) should be checked against the miss corpus: if a universal extract fix closes them, ship C3-B and skip lesson creation for that pattern.

---

## 15. Worked Johnstone example (`2205 EARLY` style)

### Happy path

1. **Example 1:** Parser misses Customer PO → C2 confirms `2205 EARLY` with `document_evidence` → **example only**.
2. **Examples 2–3:** Another Johnstone invoice, same `parserFormatId`, sender domain, allowlisted anchor (e.g. `CUSTOMER P/O`), empty/wrong PO corrected consistently → still examples until threshold → lesson becomes **PROPOSED** (pattern = “when PO empty and anchor present, capture bounded token near anchor” — **not** “always use 2205 EARLY”).
3. **Manager/Admin activates** → **ACTIVE**.
4. **Next matching invoice:** specialized parser runs → if Customer PO empty and scope/anchors match → deterministic overlay extracts bounded token from document → CURRENT may become complete via normal readiness rules → **`confidenceScore` is not automatically inflated**.
5. **Template change:** anchors/layout shift → overlay misses or humans correct away → fail/undo evidence accumulates → lesson **suspends** for review.

### Scenario matrix

| Case | Expected behavior |
| ---- | ----------------- |
| A. Same vendor / same format | Lesson may apply (fill-empty) |
| B. Same vendor / different invoice format | Different `parserFormatId` → **no match** |
| C. Different vendor / similar-looking invoice | Different `vendorKey` (+ sender) → **no match** |
| D. Contradictory corrections | Block promote / suspend |
| E. One bad human correction | Remains example; cannot activate alone |
| F. Vendor changes template | Failures/undos → suspend → review |
| G. Learned PO succeeds; another field uncertain | Only PO overlay; other fields unchanged; confidence stays honest |

---

## 16. Phased roadmap

### C3-A — D-59 amendment / architecture authorization

| | |
| --- | --- |
| **Purpose** | Make reusable `header_field_extraction` for the three fields **legally allowed** in decisions/spec |
| **Product behavior changes?** | **No** (docs/decisions only) |
| **Likely risk tier** | Fast-safe docs / decision record |
| **Likely deploy surface** | None (no gh-pages / no Firebase) |
| **Prerequisites** | Dan approval of amend text + thresholds defaults |
| **Completion status** | **COMPLETE** (2026-08-09) — authoritative in `DECISIONS.md` D-59 C3-A; no product behavior changed |

### C3-B — Harden universal Johnstone parser misses

| | |
| --- | --- |
| **Purpose** | Fix universally valid extract bugs from real miss corpus before standing up a lesson store |
| **Product behavior changes?** | **Yes** — better first-pass parse for matching shapes |
| **Likely risk tier** | Fast-safe if client-only parse parity; **high-risk** when `functions/**` parser deploy |
| **Likely deploy surface** | CF and/or gh-pages if dual client/server parsers |
| **Prerequisites** | Prefer C3-A landed; Dan may allow independent parser harden |
| **Completion status** | **COMPLETE / LIVE** — PR #111 merge `04031ca9`; CF syncInboundGmail + reparseVendorInvoiceImportCallable deployed |

### C3-C — Collect/index verified C2 examples (no parse effect)

| | |
| --- | --- |
| **Purpose** | Persist examples from C2 audits into the evidence store; admin visibility |
| **Product behavior changes?** | **No parse effect**; ops visibility only |
| **Likely risk tier** | **High-risk** (CF + `firestore.rules` for new collections) |
| **Likely deploy surface** | Firebase functions + rules; optional Settings UI (gh-pages) |
| **Prerequisites** | **C3-A** authoritative; preferably C3-B assessed |
| **Completion status** | not started |

### C3-D — Proposed → active lifecycle + audit + circuit breaker

| | |
| --- | --- |
| **Purpose** | Promotion, Manager/Admin activate, suspend/reject/archive, immutable audit, FP breaker |
| **Product behavior changes?** | Lifecycle only until C3-E; still **no overlay** until E |
| **Likely risk tier** | **High-risk** (CF/rules/auth) |
| **Likely deploy surface** | Firebase + Settings UI |
| **Prerequisites** | C3-A + C3-C |
| **Completion status** | not started |

### C3-E — Deterministic active overlay + reparse ordering

| | |
| --- | --- |
| **Purpose** | Post-parse fill-empty overlay; order parser → C3 → C2 log last |
| **Product behavior changes?** | **Yes** — future matching imports may auto-fill empty allowlisted fields |
| **Likely risk tier** | **High-risk** (CF ingest/reparse paths) |
| **Likely deploy surface** | Firebase functions; verify scripts; gh-pages if UI shows lesson provenance |
| **Prerequisites** | C3-A + C3-D; C3-B strongly preferred first |
| **Completion status** | not started |

### C3-F — Optional candidate ranking / review hints

| | |
| --- | --- |
| **Purpose** | Rank/suggest candidates in review UI without confidence inflation or auto-approve |
| **Product behavior changes?** | Review UX hints only |
| **Likely risk tier** | High-risk if CF; fast-safe if pure UI on already-returned candidates |
| **Likely deploy surface** | CF and/or gh-pages |
| **Prerequisites** | C3-E |
| **Completion status** | not started |

### Sequencing rule

```
C3-A (decision) → C3-B (base parser) → C3-C (examples) → C3-D (lifecycle) → C3-E (overlay) → C3-F (optional hints)
```

Do **not** skip to C3-E without A+D. Do **not** create a lesson store to avoid an obvious parser fix (B before C when the miss is universal).

---

## 17. Current status (concise)

| Phase | Status |
| ----- | ------ |
| C3-A | **COMPLETE** |
| C3-B | **COMPLETE / LIVE** — PO bleed + INVOICE banner; CF deployed |
| C3-C | **NEXT** — collect/index verified C2 examples (no parse effect) |
| C3-D | not started |
| C3-E | not started |
| C3-F | not started |

**NEXT C3 JOB:** **C3-C** — collect/index verified C2 examples (no parse effect). Do not start C3-D/E/F here. C3-B engineering complete — CF deploy still needs Dan approval.

**Discovery:** This file is linked from `PROJECT_STATUS/CURRENT_STATE.md` (Queued product / Canonical references) and `docs/roadmap.md` (Lane C notes).

---

## 18. Non-goals / prohibited shortcuts

Future agents **must** read this section before implementation.

### Do NOT

- Treat one correction as training
- Auto-activate lessons
- Widen beyond the three approved fields without a **new** decision
- Use absolute PDF coordinates as the only locator
- Create cross-vendor rules
- Inflate `confidenceScore` because a lesson exists
- Overwrite C2 CURRENT corrections with a learned lesson
- Auto-approve because a lesson matched
- Create a parallel general-purpose learning engine
- Silently bypass D-59 / Fable safeguards
- Overload `vendorInvoiceIgnoreRules` with extraction effects
- Use GCS playbooks as authoritative field truth
- Implement model note→rule interpretation for C3 v1 under the “minimal amend” carve-out
- Start C3-C/D/E from a C3-B conversation, or skip C3-B to paper over a universal parser miss with a lesson store

### Do

- Read this plan → verify `DECISIONS.md` + current `main`
- Prefer C3-B parser harden when the pattern is universal
- Keep C2 Apply free of implicit training UX
- Keep Lane B ignore semantics disjoint from Lane C extraction
- Fail closed; audit; make lessons reversible

---

## Appendix A — Key code / decision pointers (verify on implement)

| Concern | Where |
| ------- | ----- |
| C2 allowlist | `functions/src/invoice/reviewChat/correctionAllowlist.ts` |
| C2 apply | `functions/src/invoice/reviewChat/applyInvoiceReviewFieldCorrection.ts` |
| Evidence class | `functions/src/invoice/reviewChat/classifyCorrectionEvidence.ts` |
| Reparse + log | `applyFieldCorrectionLogToHeader` / inbound reparse paths |
| D-75 eligibility | `computeAutoImportEligibility` (client + functions mirrors) |
| Format routing | `functions/src/invoice/vendorInvoiceRouter.ts` |
| Johnstone PO extract | `functions/src/invoice/parseJohnstoneInvoice.ts` (+ client mirror if present) |
| Training-note / ignore spec | `docs/training-note-ignore-spec.md` |
| Decisions | `PROJECT_STATUS/DECISIONS.md` (D-56…D-59, D-68, D-75) |

## Appendix B — Design conversation evidence

- Critical Reviewer (Grok): PARTIAL — adopted: no v1 layoutFamily; explicit lift of field-mapping ban; deterministic #8 carve-out; separate lesson collection; thresholds as Dan policy; parser harden before lesson store; privacy/retention in amend packet.
- Q&A Verifier (Grok): PARTIAL — adopted: `trainingNoteAudit` is audit not learning store; fingerprint includes `documentType` in ignore lane (C3 scopes must stay explicit); `vendorInvoiceNumber` must be named in amend; Dan #n ≠ Fable Unsafe #n.

---

*End of C3 reusable field learning plan.*

```
C3-A: COMPLETE
C3-B: COMPLETE / LIVE; NEXT C3 JOB = C3-C
```

Update the Status table when each phase ships; keep amend wording in sync with `PROJECT_STATUS/DECISIONS.md`.*
