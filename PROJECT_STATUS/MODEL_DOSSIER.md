# stageverify Model Dossier (local)

> Local overrides + gotchas only. Universal task→model wisdom lives in the
> agent-ops skill's Global Tier Table. Confidence below is INHERITED from global —
> unverified locally until rows accrue. Log outcomes per agent-ops skill §8
> (append one line to cursor-agent-brain/outcomes/<machine>.jsonl, then push).

## Billing profile (confirmed 2026-06-02)
- **Auto + Composer quota**: ~5% used — Composer 2.5 Fast is essentially free within the plan.
- **API quota**: 100% used + $262.53 on-demand overage — Sonnet 4.6 / Opus 4.6 cost real money.
- **Policy**: Composer 2.5 Fast is the orchestrator AND default worker — do T0/T1/T2 inline. Escalate to Sonnet 4.6 (Task subagent) only for security gate or high-stakes ambiguous decisions. Opus 4.6 for T3 only.

## Local risk profile
- **Mixed SPA + backend.** Firebase Firestore + Cloud Functions v2 are live (Blaze plan, project: stageverify-db).
  Frontend work (T0–T2): Tailwind restyles, React components, routing, TS model refactors.
  Backend work: classify as `backend-write-critical` for any Firestore security rules, Cloud Function write paths, or schema migrations.
- **backend-write-critical: ACTIVE (trial in progress).** Firebase Firestore + Cloud Functions live as of 2026-05-31.
  Any change to security rules, Cloud Function logic, or Firestore data schema → `backend-write-critical`.
  Active trial: Composer 2.5 (3/5 clean passes). Grader: Sonnet 4.6. Locked fallback (if all candidates fail): Opus 4.6.

## Security review gate
- Runs MANDATORY after every `backend-write-critical` commit and any `multi-file-feature` touching auth/routes/Firestore.
- Scanner: Gemini 3 Flash (`read-only-analysis`). Verifier: Sonnet 4.6.
- BLOCK deploy on any HIGH risk finding until fixed and re-scanned.
- See agent-ops SKILL.md §11 for full protocol.

## Stack-specific archetype hints
- Tailwind 4 is CSS-first (no config file) → css-restyle work edits utility classes / @theme.
- src/types.ts is legacy and targeted for deletion → type-refactor toward src/dispatcher/models.ts.
- Service layer (src/dispatcher/service.ts) currently wraps mocks → service-logic.
- QR/camera via html5-qrcode → device-integration (test on a real device; camera perms differ).

## Local gotchas
- **Zone/receive QR** — use `buildReceiveDeepLink` (`src/receiveQrUrls.ts`): `?id=` when zone has a job (zone cards), else `?zone=`; `normalizeReceiveHash` for `#receive` without `/`; shared `RECEIVE_BLOCKED_DELIVERY_STATUSES`; Sonnet review before deploy.
- **New `DeliveryStatus`** — if terminal, add to `RECEIVE_BLOCKED_DELIVERY_STATUSES` same change.

## Active outcome log (≤ ~15 rows, then rotate to archives/outcomes/YYYY-Www.md)
| Date | Task | Archetype | Model | Conf→ | Outcome | Note |
|------|------|-----------|-------|-------|---------|------|
