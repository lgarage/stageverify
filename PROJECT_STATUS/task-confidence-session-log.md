# Session task-type / confidence log

Running log per Dan standing preference (classify → cheapest model → conf → do work).

| Date | Task type (archetype) | Tier | Recommended model | confStart | confAfter | Outcome | Note |
|------|----------------------|------|-------------------|-----------|-----------|---------|------|
| 2026-08-05 | backend-write-critical (CF redeploy only — no code edits) | T3 | Composer 2.5 Fast (shell/deploy; Sonnet gate already on prior ship) | 98 | 99 | ok | `applyVendorReplyClearBackorder` redeployed to stageverify-db |
| 2026-08-05 | product-requirements / UX Q&A (drawer status dropdown) | T0 Q&A | GPT-5.4 Mini (facilitate Q&A); later build → Composer 2.5 T2 multi-file-feature | 95 | 95 | ok | No implement; scenario questions only; delivery-status + delivery-display-wiring |
| 2026-08-05 | product-requirements synthesize (status dropdown answers) | T0 Q&A | GPT-5.4 Mini; later build → Composer 2.5 T2 (+ high-risk if enum/CF) | 92 | 94 | ok | Locked 1–9,13–14; clarify Staged spot + revert; open Complete/Installed/label |
| 2026-08-05 | product-requirements freeze (A/C/D + draft list) | T0 Q&A | GPT-5.4 Mini; later build → Composer 2.5 T2 (+ high-risk enum/CF) | 94 | 96 | ok | A same-step spot; C Ready for Pickup; D Complete→Picked Up wording; B Cancelled/Returned undo OPEN |
| 2026-08-05 | product-requirements FROZEN (drawer status dropdown) | T0 Q&A | GPT-5.4 Mini; build later → Composer 2.5 T2 (+ high-risk) | 96 | 99 | ok | Cancelled/Returned undoable; full 10-option list ready for sign-off |
| 2026-08-05 | harness Q&A (D-50 vs Dan “Grok tells Composer”) | T0 Q&A | GPT-5.4 Mini / Grok parent | 90 | 95 | ok | Rules checked; build blocked pending Q1–Q5; D-50 mismatch flagged |
| 2026-08-05 | product build gate (status dropdown v1 scope lock) | T2/T3 high-risk | Composer 2.5 + D-60/D-38 Sonnet; Grok checks | 88 | 88 | pending | Answers 1A–5 in; 2 clarifiers before D-60 instruct |
| 2026-08-05 | multi-file-feature (drawer status + fulfillment v1) | T2 high-risk | Composer 2.5 + D-60/D-38 Sonnet; Grok check/ship | 97 | 99 | ok | v0.0.207 7387b30; D-62 written; ship-verifier PASS |
| 2026-08-05 | backend-write-critical (will-call → Picked Up category) | T3 high-risk | Composer 2.5 + D-60/D-38 Sonnet | 92 | 92 | pending | Root cause: recordPickupEvent requires staging; blocked on Dan CF approve |
| 2026-08-05 | bug-investigate + CF fix (rejected invoices reappear) | T3 backend-write-critical | Composer 2.5 Fast | 97 | 99 | ok | Root cause: Gmail reparse treated user credit/return reject as system skip; fix isSystemAutoRejectedImport |
| 2026-08-07 | backend-write-critical (P0-ROI TECH_JOB_OPENED CF) | T3 high-risk | Composer 2.5 + D-60/D-38 Sonnet; Grok verify | 94 | 99 | ok | recordTechnicianJobOpen; sonnet Agree+PASS; tests 14/14; branch PR no deploy |
| 2026-08-08 | readonly-prod-audit (MGMT-VERIFY fixtures) | T0 scout | Composer 2.5 Fast | 90 | 97 | ok | Live Firestore audit before delete |
| 2026-08-08 | backend-write-critical (prod SAFE test-data delete) | T3 high-risk | Composer 2.5 Fast (+ Grok delete review) | 88 | 98 | ok | 21 deliveries+10 items deleted; job-1 restored; D-38 Sonnet unavailable |
| 2026-08-08 | service-logic (verifier fixture teardown) | T1 | Composer 2.5 Fast | 95 | 98 | ok | catch-all + monday-safe finally cleanup; PR #42 |
