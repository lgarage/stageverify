# stageverify Model Dossier (local)

> Local overrides + gotchas only. Universal task→model wisdom lives in the
> agent-ops skill's Global Tier Table. Confidence below is INHERITED from global —
> unverified locally until rows accrue. Log outcomes per agent-ops skill §8
> (append one line to cursor-agent-brain/outcomes/<machine>.jsonl, then push).

## Local risk profile
- **Mixed SPA + backend.** Firebase Firestore + Cloud Functions v2 are live (Blaze plan, project: stageverify-db).
  Frontend work (T0–T2): Tailwind restyles, React components, routing, TS model refactors.
  Backend work: classify as `backend-write-critical` for any Firestore security rules, Cloud Function write paths, or schema migrations.
- **backend-write-critical: ACTIVE (Opus 4.6 floor).** Firebase Firestore + Cloud Functions live as of 2026-05-31.
  Any change to security rules, Cloud Function logic, or Firestore data schema → `backend-write-critical`. Locked at Opus until Phase 2b trial earns promotion.

## Stack-specific archetype hints
- Tailwind 4 is CSS-first (no config file) → css-restyle work edits utility classes / @theme.
- src/types.ts is legacy and targeted for deletion → type-refactor toward src/dispatcher/models.ts.
- Service layer (src/dispatcher/service.ts) currently wraps mocks → service-logic.
- QR/camera via html5-qrcode → device-integration (test on a real device; camera perms differ).

## Local gotchas
- (add as discovered — one bullet per hard-won lesson)

## Active outcome log (≤ ~15 rows, then rotate to archives/outcomes/YYYY-Www.md)
| Date | Task | Archetype | Model | Conf→ | Outcome | Note |
|------|------|-----------|-------|-------|---------|------|
