# stageverify | Current State

> READ THIS FILE FIRST every session. Hot-tier — hard cap ~30 lines.
> **Memory router:** `PROJECT_STATUS/MEMORY.md` — concern → file → when to read.
> **Product authority (on demand):** `PROJECT_STATUS/svscope_simple.md` — scope wins on conflict; load only for scope disputes.

## Snapshot
- **Standing harness:** every session honors **D-47** conf ≥ 97% before any file edit; **D-60** high-risk Sonnet instruct→verify loop on auth/CF/rules ships (`high-risk-sonnet-loop.mdc`).
- **MVP: 100.00% — done** — SSOT reconciled 2026-07-16 (`MVP_PATH.md`). §14 E2E prod re-verify **PASS** away-130 (2026-07-17).
- **Partial deploy:** D-59 P2–P7 on `main` (`49924c8b`, v0.0.204). **gh-pages LIVE** @ v0.0.223. **Firebase rules NOT deployed** — Sonnet pre-deploy APPROVE (`bf2570ff…`); console TTL on `trainingNoteAudit.expireAt` still needed after rules deploy. **CF deployed:** credit-return delivery block (ingest auto-reject + approve/create_shell/relink guard) @ v0.0.217; prior `approveVendorInvoiceImport` credit-return reject @ v0.0.215 (`eb000e7`); `recalculateDeliveryReadiness` + will-call preserve @ v0.0.214 (`5f1f575`); `recordPickupEvent` (`4755802`); **reject-preserve Gmail sync** @ v0.0.213 (`9529530`).
- Last shipped: **v0.0.223** — merge PR #39: Settings Workflow **StageVerify Start Date** (`appSettings.stageVerifyActivatedAt`, YYYY-MM-DD); Green Bay live `2026-08-10` (editable); `verify:settings-staging` PASS. [fast-safe UI]
- Prior: **v0.0.222** — merge PR #38: unauthenticated technician Complete Pickup (remove client getDoc before recordPickupEvent). [fast-safe]
