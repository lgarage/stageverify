# Security scan — invoice ingest + public routes (away-105)

**Date:** 2026-07-04  
**Verdict:** HIGH (two primary gaps → away-106, away-107)  
**security-gate-id:** b87e1470-8f53-49fb-a926-54a580a1a987  
**model:** claude-4.6-sonnet-medium-thinking

## HIGH — implement in batch

| ID | Finding | Fix item |
|----|---------|----------|
| H1 | Unauth Firestore writes for `stagingLocationId` / `additionalStagingLocationIds` (`firestore.rules:96-118`) — no vendor session binding | away-107 |
| H2 | Unauth item qty / delivery status writes without vendor session (related; defer CF hardening to follow-on) | future away |

## MEDIUM — away-106 scope

| Finding | Location |
|---------|----------|
| `requireDispatcherAuth` = any signed-in Firebase user, not dispatcher role | `functions/src/inboundEmail/dispatcherAuth.ts` |
| `vendorInvoiceImports` / `inboundEmailProcessing` readable by any authed client | `firestore.rules:245-254` |

## MEDIUM — defer (not in away-106/107)

- Invoice approve without delivery match validation → tighten in away-103 link flow
- `vendorPinVerifier` on public delivery docs → follow-on
- `createMaterialIssue` without pickup token → follow-on

## Implementation notes

- **away-106:** `dispatcherRoles/{uid}` collection + `isDispatcher()` rules helper; async `requireDispatcherAuth`.
- **away-107:** Remove staging fields from `unauthDeliveryUpdateAllowed()`; vendor staging via session-gated CF.
