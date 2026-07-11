# stageverify Model Dossier (local)

> **Hot tier — read index first.** Match your task to a tag; open § detail only if needed.
> Universal model wisdom: agent-ops skill §2. Outcome write-back: skill §8.
> Cold detail: `PROJECT_STATUS/archives/dossier-notes.md`

## Index

> **Index-first:** `npm run dossier:slice -- --tag <tag>` — do not read this full file for one §.

| Tag | Open when task touches… | One-line rule |
|-----|-------------------------|---------------|
| `qr-routing` | QR, scan, deep links, ESL tags | **Only** `scanRouting.ts` + `receiveQrUrls.ts` — never duplicate logic in Receive/Pickup; vendor UI is **only** `ReceivingPage` (`/#/receive`) |
| `zone-lookup` | staging code → delivery | `getDeliveryDetailsByStagingCode`; match zones via `getAllStagingLocationIds` |
| `receive-deep-link` | `/receive` URL params or camera | `deepLinkPending` before camera; failed lookup → show error (no silent empty screen) |
| `encode-qr` | building QR URLs | `buildEslTagQrUrl` + `EslQrCode` — dispatcher print = zone e-tag; `forPrint` → prod base; long `#/receive?` / `#/pickup?` forms emitted (compact `#/r?` / `#/p?` parse-only legacy) |
| `html5-qr-type` | camera scanner | `Html5QrcodeInstance` from `qrScannerTypes.ts` — no `any` |
| `delivery-status` | new `DeliveryStatus` | update `RECEIVE_BLOCKED` and `ZONE_CLEARED` in same change |
| `backend-critical` | rules, CF writes, schema | archetype `backend-write-critical`; Sonnet gate before deploy |
| `billing` | model / tier pick | Composer 2.5 default; Sonnet 4.6 for gate/review only |
| `agent-lessons` | repeating mistakes, QR/hash races, "say fixed" too early | Read **§ agent-lessons** (+ Diagnose before tweak) before public routes / scan fixes |
| `delivery-display-wiring` | list filter, drawer status, partial @ qty=0, unit counts | Read **§ delivery-display-wiring** before dispatcher list/drawer readiness edits |
| `scope-rejections` | portal nav, Settings vs Vendors, duplicate sidebar | **≤8 rows** in `USER_SCOPE_REJECTIONS.md` only when editing that nav |
| `composer-trace` | 1st fail → self-trace prep; 2nd same fingerprint → Grok stall-advisor; still stuck → Sonnet diagnose-only | **§ Composer without Sonnet** — see `model-gates.mdc` § 2-fail + § Grok stall-advisor |
| `stall-advisor` | 2nd consecutive same-failure stall mid-task | **§ Stall Advisor — Grok 4.5 Fast** (tier 1b) — SSOT in `model-gates.mdc` § Grok stall-advisor auto-invoke |
| `critical-reviewer` | major architecture/harness/workflow decisions pre-finalize | **§ Critical Reviewer — Grok 4.5 Fast** — triggers in `model-gates.mdc` § Critical Reviewer auto-invoke |
| `work-verifier` | Fable-spec phase boundaries, Ship Verifier escalations, "fable verify" | **§ Work Verifier — Fable 5** (tier 3 only) — triggers in `model-gates.mdc` § Work Verifier auto-invoke |
| `ship-verifier` | post-ship verification after every substantive ship | **§ Ship Verifier — Grok 4.5 Fast** (tier 1) — SSOT in `model-gates.mdc` § Ship Verifier auto-invoke |

## § qr-routing
- Entry points: URL deep link, camera callback, manual input — all call `handleScannedQr(raw, "receive-page")`.
- **Single vendor UI:** `ReceivingPage` at `/#/receive`. Legacy `/#/`, `/#/checkin/:id`, compact `#/r?` rewrite to receive. Demo QR: `/#/demo/vendor-scan`.
- `appSettings.vendorDeliveryMode`: `exception_only` (Delivered hub) \| `full_checkin` (line-item flow, same page).
- Zone e-tags + dispatcher print: `buildEslTagQrUrl` / `buildZoneEslQrUrl` — long `#/pickup?` / `#/receive?id=` / `#/receive?zone=` (compact `#/r?` / `#/p?` parse-only). Printed location signs: **static** `#/s?loc={code}`, never changes — occupancy-dynamic QR-flip REJECTED (`docs/location-first-transition-spec.md`; route lands Phase 3).

## § zone-lookup
- QR routing: `getDeliveryDetailsByStagingCode` (includes pickup-ready; most-recently-updated on collision — Phase 3 replaces with the role-aware resolver per `docs/location-first-transition-spec.md`).
- Receive-only (exclude blocked): `getDeliveryDetailsPublicByStagingCode`.
- Occupancy map: `mapActiveZoneOccupancyByCode`.

## § billing
- Composer 2.5 = orchestrator + default worker (included quota).
- Sonnet 4.6 = security gate + authority review only (on-demand cost).
- **Public Firestore writes:** code fix + `firebase deploy --only firestore:rules` in the same session — `npm run deploy` (gh-pages) does not ship rules.

## § backend-critical
- Trial: Composer implements; Sonnet grades. 3/5 clean passes.
- Mandatory Sonnet gate after rules/CF/schema **and** multi-file route/Firestore read changes.

## § agent-lessons (2026-06-02 — pickup portal arc)

**Rolling SSOT:** `PROJECT_STATUS/LIBRARIAN_LESSONS.md` — read first for session lessons; this § keeps domain-deep pickup/QR/Firestore detail.

Hard-won mistakes — **read before declaring UI/Firestore work done.**

1. **Do not say "fixed" without Playwright.** Build alone is insufficient. Interactive flows need `scripts/verify-*.mjs` (clicks + assert end state). Pickup: `npm run verify:pickup` then `:prod` after deploy.
2. **`npm run deploy` ≠ Firestore rules.** gh-pages ships the SPA only. Public technician writes need `firebase deploy --only firestore:rules --project stageverify-db` in the **same session** as the code change.
3. **Public routes must not call auth-only reads.** `listDeliveries()` loads `jobs` → empty or throws when logged out. Pickup uses `loadPickupReadyDeliveriesPublic()`. Any new public page: audit for `getDeliveryDetails`, `listDeliveries`, `fetchAll<Job>`.
4. **`recordPickupEvent` / technician writes:** use delivery doc + batch write; never reload `getDeliveryDetails` after commit on technician path (permission denied for unauth).
5. **Logged-in browser ≠ Playwright.** Dan may see data while headless test sees empty list — always verify unauthenticated or with the verify script.
6. **Confidence downgrade when user still sees the bug.** Code-only fix that doesn't deploy rules or pass E2E → lower conf, do not mark ok until Playwright + user path green.
7. **Auto-submit and Done must share the same gates** (shop stock + staged item checklists) — any second code path bypassing a gate will reproduce the bug.
8. **Scope:** do not add portal pickers, cross-links, or hub buttons unless Dan asked. Check `USER_SCOPE_REJECTIONS.md` before `PortalNavBar` / `MobileHubPage` edits.
9. **1st fix failed → § Composer without Sonnet** self-trace prep; **2nd same fingerprint → Grok stall-advisor** (`stall-advisor:` line); **still stuck → Sonnet diagnose-only** per `model-gates.mdc`; Composer implements after Grok/Sonnet returns.
10. **Separate “shipped code” from “fixed for Dan”** — deploy + Playwright + (for public writes) rules deploy.
11. **Away batches:** follow `PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md` — orchestrator runs verify; parallel scouts read-only only.
12. **Public vendor flows must use public-safe hydration paths.** Do not call authenticated dispatcher/admin detail readers (`getDeliveryDetails`, `fetchAll<vendors>`) after unauthenticated vendor writes. Use `getDeliveryDetailsPublic`, denormalized `delivery.vendorName` for occupancy, and `hydrateAfterVendorWrite` patterns.

## § delivery-display-wiring (2026-06-23 — away-072/073 arc)

Hard-won rules — **read before list/drawer/filter readiness edits.**

1. **List + drawer + filters use computed readiness** — `computeDeliveryDisplayState` / `deliveryDisplayHelpers.ts`; never raw `delivery.status` alone for Partial/Pending/Ready labels.
2. **Unit counts (sum qty), not line counts** — received/total and partial progress are quantity-based (`4cf65a8`).
3. **Partial only when anyReceived > 0** — qty=0 cannot persist or display as partial (`away-073`; client + CF alignment).
4. **Live `materialIssues` override stale `openBlockingIssueCount`** — drawer/list blockers must reflect unresolved issues, not stale denormalized counts.
5. **Verify before ship:** `npm run verify:delivery-consistency`, `npm run test:readiness-two-source`, `npm run test:demo-matrix`.

**Known gap (stale status audit):** staging assignment without immediate readiness recalc can leave persisted status ahead of computed state — treat list filter fix (`5ba4e0f`) as UI guard; CF recalc on assign still TBD.

### Diagnose before tweak (2026-06-02 QR)

Map **appear** vs **tap** before camera/fps tweaks (Sonnet postmortem on double-navigation):

| Phase | Hooks | Hash / routing |
|-------|--------|----------------|
| Appear (preview) | `onQrPreview`, `startScanPrefetch` | **None** — prefetch read-only |
| Tap (confirm) | `confirmPreview`, `onDecode`, `handleQrFromCamera` | `applyHashFromScannedQr`, `scanRouting`, deep-link `useEffect` |

**Grep preview path only:** `applyHashFromScannedQr`, `location.hash`, `useSearchParams`, `urlDeepLinkHandledRef`, `confirmingRef`, `resetFlow` (must clear deep-link ref).

**Rule:** prefetch = read-only; navigation/hash only on confirm.

**One acceptance test first:** scan → yellow pill → tap → single correct route (no flash/wrong portal).

**Sonnet-style trace when:** 2+ failed fixes on same bug, or preview + async prefetch + hash/deep-link in one flow.

## § Composer without Sonnet (make Composer “best”)

**Goal:** Sonnet only for (1) security gate / `backend-write-critical`, (2) **still stuck** after Grok stall-advisor or **2nd failed fix** with different fingerprint — diagnosis only; Composer implements after Grok/Sonnet returns.

### Before any code (session start on scan/nav/async)

1. Read `§ agent-lessons` + symptom table if task touches QR, pickup, receive, or portal.
2. State **one sentence**: what Dan asked vs what you will not add.

### On 1st failed fix (recommended self-trace prep)

Composer posts this block **in the reply** (not only in docs) before the retry. On **2nd failure with same fingerprint**, dispatch Grok stall-advisor (mandatory) — include this block in the prompt. When **still stuck**, dispatch Sonnet for diagnosis only — repost this block at escalation; Composer implements after findings.

```
Symptom: (a) decode | (b) slow after decode | (c) wrong route after tap
Appear: [hooks that run on decode/preview — hash? prefetch?]
Tap: [hooks on confirm — hash? navigate?]
Grep: applyHashFromScannedQr, location.hash, *DeepLink*, confirmingRef
Hypothesis: one sentence
Next change: one file/behavior only
```

Only after that: one fix + one verify script run. **Do not** call Sonnet for diagnosis before Grok stall-advisor (2nd same fingerprint) or still-stuck threshold — security gate Sonnet runs remain separate.

### What Dan can do (high leverage)

| You say | Composer must |
|---------|----------------|
| “Column (a)” / “won’t scan” | Camera/config only — no hash/prefetch |
| “Column (b)” / “slow loading” | Firestore trace — no pill/camera |
| “Column (c)” / “tap broken” | appear-vs-tap grep — no fps/URL density |
| “Log scope rejection: …” | Row in `USER_SCOPE_REJECTIONS.md` + remove UI same commit |
| “Still not fixed” | `confAfter` ≤ 50 in brain log; no “done” |

### Confidence logging (agent-ops)

- **confStart** = tier table default.
- **confAfter** = after verify + Dan signal; downgrade ≥15 if “still broken” without new hypothesis.
- Tag `composer-trace` when self-trace prep ran on 1st fail; `stall-advisor:` when Grok ran on 2nd same fingerprint; `outcome: escalate` when Sonnet ran for still-stuck diagnosis.

### Rule file alignment

See `model-gates.mdc` § 2-fail + § Grok stall-advisor. Sonnet stays mandatory for rules/auth gate and still-stuck diagnosis, not for routine first attempts.

## Critical Reviewer — Grok 4.5 Fast (tag: critical-reviewer)

Purpose: skeptical outside-party review before major architecture, harness, or workflow decisions are finalized. A different model family has uncorrelated blind spots and no authorship bias — pilot run 2026-07-08 caught a factual error (aecs install state) and two design flaws (Phase 4 silent attach failure, inverted path-classifier risk) that two same-model review passes missed.

- Model: `grok-4.5-fast-xhigh` via generalPurpose Task, `readonly: true`, never edits code
- Triggers + exclusions (SSOT): `.cursor/rules/model-gates.mdc` § Critical Reviewer auto-invoke
- Never overrides Fable (architecture), Sonnet 4.6 (security verdict), or Composer (build/ship)
- Required output, exactly five sections: strongest concern · simplification opportunities · hidden risks · alternative approach · final recommendation with confidence
- Evidence: Task id + model line in the report, else NOT RUN (same standard as security gate)
- Budget: one run per decision; rerun only if the plan materially changes after review

## Work Verifier — Fable 5 (tag: work-verifier)

Purpose: **tier 3 (rare, expensive)** deep verification — semantic drift a path check or Ship Verifier cannot judge. Fable never edits code, never ships, never overrides Sonnet security verdicts. Per-ship verification belongs to the Ship Verifier (Grok, tier 1) — not Fable. Verify-only — never edits files; Composer implements, Fable re-verifies, ship gated on Fable pass.

- Model: `claude-fable-5-thinking-high` via generalPurpose Task, `readonly: true`
- **Triggers (only these):** (1) phase boundary of a Fable-authored product/architecture spec with semantic drift tripwires — before phase N+1 (spec's own gate note, e.g. `docs/location-first-transition-spec.md`, stays authoritative); (2) Ship Verifier escalates ambiguity/architecture concerns; (3) Dan says "fable verify" / "fable check". NOT for mechanical checklist phases, away batches, routine T2+, or red-gate diagnosis (Sonnet 2-fail owns that).
- **Preconditions:** build + `away:validate` (+ route `verify:*` when UI) green; mechanical `git diff --name-only` vs allowed paths runs first, fail closed.
- **Fix loop (max 1 cycle):** exact fix list (tripwire id, PASS/FAIL, file:line, required change) → Composer applies → Fable re-verifies ONCE → still failing → Dan.
- **Evidence:** Task id + `model: claude-fable-5-thinking-high` + invocation evidence, else NOT RUN; spec-phase NOT RUN blocks phase N+1 (`work-verifier:` report line per `model-gates.mdc`).

## Ship Verifier — Grok 4.5 Fast (tag: ship-verifier)

Purpose: **tier 1 (cheap)** post-ship verification after EVERY substantive ship — scope fidelity, correctness, and whether the Sonnet security gate should have fired but didn't. Never judges security itself — directs Composer to invoke the Sonnet gate when a security-relevant diff shipped without a `security-gate-id`.

- Model: `grok-4.5-fast-xhigh` via generalPurpose Task, `readonly: true` — never edits code
- **SSOT:** `model-gates.mdc` § Ship Verifier auto-invoke — substantive-ship path classification (`src/`, `functions/src/`, `public/`, `index.html`, behavior-bearing `scripts/*.mjs`; never commit-prefix), one Task per ship (multi-commit = one range), `ship-verifier:` report line, blocking semantics, 1-fix-cycle loop with escalation to Fable (ambiguity/architecture) or Dan.
- Distinct from the Critical Reviewer role (same model, pre-decision devil's advocate — separate triggers).

## Stall Advisor — Grok 4.5 Fast (tag: stall-advisor)

Purpose: **tier 1b (cheap)** mid-task pivot when Composer hits the **same failure twice** — ranked hypotheses and next experiments only; Composer implements after. Not post-ship (Ship Verifier) and not pre-decision review (Critical Reviewer).

- Model: `grok-4.5-fast-xhigh` via generalPurpose Task, `readonly: true` — never edits code
- **SSOT:** `model-gates.mdc` § Grok stall-advisor auto-invoke — same failure fingerprint table, one Task per fingerprint per task scope, `stall-advisor:` report line
- Sonnet diagnose-only runs when **still stuck** after Grok (different fingerprint on 2nd fail, or 3rd+ fail) — see § 2-fail
