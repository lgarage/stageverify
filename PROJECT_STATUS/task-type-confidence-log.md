# Task type → model confidence log

Append-only session log (Dan standing preference). Not a planning SSOT.

| Date | Task type | Archetype | Tier | Cheapest model | confStart | confAfter | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-10 | C3-D.1 Settings Invoice Learning read-only visual verify UI | ui-component / visual-judgment | T1 | Sol High (`gpt-5.6-sol-high`) + Composer wiring/ship | 98 | 99 | FE-only v0.0.285; list API enough; no evaluate button; no CF/rules |
| 2026-08-10 | Timekeeper long-job terminal audit (read-only) | harness-audit / scout | T0 | Composer 2.5 Fast | 92 | 98 | enforcement/visibility gap; once-only force35; no edits |
| 2026-08-10 | Timekeeper sticky post-35m re-nudge (D-72) | harness-tooling | T0/T1 | Composer 2.5 Fast | 98 | 99 | ~5m sticky + stop re-followup; 51/51 tests; advise-only; PR only |
| 2026-08-09 | Invoice Review staging → Staging Map (PR #97 UX) | ui-component / visual-judgment | T1 | Sol High review + Composer 2.5 Fast implement | 98 | 99 | FE-only v0.0.274; solution-verifier Agree; Sol final PASS |
| 2026-08-09 | ship-op (PR #112 merge + approveVendorInvoiceImport deploy D-79) | ship-op / CF deploy | T3 | Composer 2.5 Fast | 99 | 99 | merge 02a48bbb; CF hash f27f5aeb; smoke 6167746 PASS |
| 2026-08-09 | Fulfillment persist create_shell overwrite (6169414/6169474) | backend-write-critical | T3 | Composer 2.5 Fast + Sonnet D-60 + Grok adversarial + D-38 | 99 | 99 | Investigate→implement; no CF deploy until Dan |
| 2026-08-09 | Named Admin access-control redesign (auth/PIN/roles) | backend-write-critical | T3 | Composer 2.5 Fast (inline) + Sonnet D-60/D-38 | 92 | 98 | High-risk; Agree-with-revisions packet; PR #73; no deploy |
| 2026-08-09 | Atomic bootstrap + Admin identity integrity (PR #73 required fixes) | backend-write-critical | T3 | Composer 2.5 Fast (inline) + Sonnet D-60/D-38 | 97 | 99 | Approved fix list; dedicated bootstrapFirstAdmin; no deploy |
| 2026-08-09 | Named Admin production closeout verification (no bootstrap/PIN) | docs-update / prod-verify | T0 | Composer 2.5 Fast (inline) | 99 | 99 | Re-verify invariants + Manager denials; Dan manual Admin Access; no deploy |
| 2026-08-09 | Vendor PIN companyWide + uniqueness dual-check (D-76 / PR #86) | backend-write-critical | T3 | Composer 2.5 Fast + Sonnet D-60/D-38 | 98 | 99 | Prod data + CF dual-check; merge 07b3cd17 |
| 2026-08-09 | Approve CF deploy PR #86 (D-76 closeout) | ship-op / CF deploy | T3 | Composer 2.5 Fast (inline) | 99 | 99 | firebase deploy functions LIVE; CURRENT_STATE stamp 32e7b484 |
| 2026-08-09 | Vendor-run multi-job card unify (hub shell/gaps/Back/green collapse+Undo) | ui-component / css-restyle | T1 | Sol Task→gpt-5.6-sol-high | 98 | 99 | Visual-judgment mobile D-27; monday-safe 63/63; v0.0.262 |
| 2026-08-09 | ship-op (vendor-run card unify merge+deploy v0.0.262) | ship-op / mobile D-27 | T1 | Composer 2.5 Fast | 99 | 99 | LIVE index-GCr3QEjg.js; monday-safe prod 63/63 |
| 2026-08-09 | Dispatcher Deliveries status legend/row wording+colors align | ui-component / css-restyle | T1 | Composer 2.5 Fast (simple-ui — D-65) | 98 | 99 | FE-only; legend green/orange/yellow/gray match badges; v0.0.265 |
| 2026-08-09 | Review/merge/deploy/prod-verify PR #96 Assign Location restore | ship-op / prod-verify | T1 | Composer 2.5 Fast | 98 | 99 | Rebase conflict w/ #98; retarget 264; merge 59c9221a; smoke PASS under tip 265 |
| 2026-08-09 | Add MANUAL TEST FOR DAN harness requirement (D-78) | docs-update / harness-rules | T0 | Composer 2.5 Fast | 98 | 99 | No product code; Critical Reviewer amendments adopted |
| 2026-08-09 | Unplanned status single-badge + U1 fixture cleanup | ui-component / service-logic | T1 | Composer 2.5 Fast (simple-ui/non-UI — D-65) | 97 | 99 | FE display override; prod U1 deleted; teardown UV; v0.0.266 |
| 2026-08-09 | Timekeeper D-72 visibility + cadence hardening | harness-tooling | T0/T1 | Composer 2.5 Fast | 98 | 99 | pending→delivered; denser ~10–35m; 37/37 tests; PR only; no product deploy |
| 2026-08-09 | ship-op merge PR #109 (Timekeeper harness) | ship-op / harness | T0 | Composer 2.5 Fast | 99 | 99 | ready→MERGED `6ea99d1f`; no gh-pages/CF/rules |
| 2026-08-09 | ship-op / D-60 re-entry PR #97 (Sonnet→Grok→Sonnet→D-38; no merge/CF deploy) | backend-write-critical | T3 | Composer 2.5 Fast + Sonnet D-60 + Grok adversarial | 98 | 99 | FE false-success fix 989d018d; gate UUID bare; create_shell=A; CF held |
| 2026-08-09 | ship-op (PR #97 merge+CF+gh-pages; list CF pending) | backend-write-critical | T3 | Composer 2.5 Fast | 99 | 99 | merge 51b87354; 4 CFs LIVE; listVendorInvoiceImports strips draft — need Dan approve |
| 2026-08-09 | Settings PIN visit-scoped PIN # updated badge | ui-component / css-restyle | T1 | Sol advice+review (`gpt-5.6-sol-high`) + Composer 2.5 Fast build | 98 | 99 | FE-only visit state; Sol visual PASS; v0.0.271 LIVE |
| 2026-08-09 | ship-op merge+deploy PR #113 PIN # updated badge | ship-op / prod-verify | T1 | Composer 2.5 Fast | 99 | 99 | merge `64197430`; gh-pages `index-DZiw9ihY.js`; verify:settings-technicians:prod PASS |
| 2026-08-09 | Staging Map zoom + logical canvas size | ui-component / spatial-design | T1 | Sol High (design+visual) + Composer 2.5 Fast (implement) | 97 | 99 | v0.0.273 LIVE index-BFt4Qudd.js; verify:shop-map-zoom:prod PASS |
| 2026-08-09 | Staging Map header toolbar relocate + future warehouse nav doc | ui-component / css-restyle | T1 | Sol High + Composer 2.5 Fast | 98 | 99 | FE-only v0.0.276; zoom unchanged; roadmap POST-MVP recorded |
| 2026-08-09 | ui-component / delivery-details-staging-needed-card | T1 | composer-2.5-fast (+ Sol UX) | confStart 98 → confAfter 99 | FE resolvable active staging SSOT; v0.0.277 LIVE |
| 2026-08-09 | C3-C.1 evidence-store implement (distinct sourceDocumentKey) | backend-write-critical | T3 | Composer 2.5 Fast + Sonnet D-60 + Grok adversarial | 98 | 99 | C3-C.1 only; no deploy |
| 2026-08-09 | ship-op (PR #125 merge + CF/rules deploy + prod verify C3-C.1) | ship-op / CF+rules deploy | T3 | Composer 2.5 Fast (inline) | 99 | 99 | merge 68ddc9b1; CF 00005-wec; rules f3468767; no TTL; C3-C.2 deferred; C3-D NEXT not started |
| 2026-08-09 | ship-op (PR #121 merge + D-80 CF/gh-pages + prod verify) | ship-op / CF deploy + prod-verify | T3 | Composer 2.5 Fast | 99 | 99 | merge 1b4c2eea; CF hash 2591e359… (2 fns); agent FE 1–10 PASS; awaiting Dan MANUAL |
| 2026-08-10 | ship-op (D-80 Dan MANUAL acceptance + archive) | ship-op / acceptance closeout | T0 | Composer 2.5 Fast | 99 | 99 | Dan PASS v0.0.279; pink category separate; CURRENT_STATE stamp |
| 2026-08-10 | backend-write-critical / ship-op | Change Location CF reassign LIVE | T3 | Composer 2.5 Fast | 99 | 99 | ok |
| 2026-08-10 | Invoice Review Approve→fulfillment decision flow | backend-write-critical + visual-judgment UI | T3 | Composer 2.5 Fast + Sol High + Sonnet D-60/D-38 + Grok adversarial | 88 | 99 | PR open; CF deploy NOT approved; tip 731e8f3a |
| 2026-08-23 | WHAT NEEDS ATTENTION COPY TOO WORDY | ui-component / simple-ui copy | T1 | Composer 2.5 Fast + Sol High visual review | 98 | 99 | FE-only WNA compact title/Why/Next; readiness unchanged |
| 2026-08-23 | Delivery Details unified Order Summary (delivered stays in same list) | ui-component / visual-judgment | T1 | Sol High (`gpt-5.6-sol-high`) + Grok orchestrate/ship | 98 | 99 | FE-only v0.0.308; deriveItemIssueDisplayStatus + effectiveItemQtyReceived; no CF/rules |
| 2026-08-23 | Staging Map open-spot Assign Location identity/availability | service-logic | T2 | Composer 2.5 Fast | 97 | 98 | FE-only v0.0.311; no CF/rules; backend occupancy guard unchanged |
