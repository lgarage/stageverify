# stageverify Model Dossier (local)

> Local overrides + gotchas only. Universal task→model wisdom lives in the
> agent-ops skill's Global Tier Table. Confidence below is INHERITED from global —
> unverified locally until rows accrue. Log outcomes per agent-ops skill §8
> (append one line to cursor-agent-brain/outcomes/<machine>.jsonl, then push).

## Local risk profile
- **Lower-risk frontend SPA.** No backend, no auth, no Firestore/DB writes today.
  Most work is T0–T2: Tailwind restyles, React components, routing, TS model refactors.
- **backend-write-critical: DORMANT (locked at Opus 4.6).** stageverify has no backend
  yet. Activate the Opus floor the moment Firebase/Supabase persistence, auth, or
  security rules land — that's a new archetype in play.

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
