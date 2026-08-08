# Access PIN migration inventory (read-only)

**Collected:** 2026-08-08 — Firestore REST via `FIREBASE_TOKEN` (read-only scan).

**Important:** These counts are **not** from `migrateAccessPins({ dryRun: true })` — that Cloud Function is **undeployed** on prod. This inventory is a REST-side classification snapshot only.

## Counts (2026-08-08)

| Category | Count |
| --- | ---: |
| Technician plaintext/recoverable | 2 |
| Technician hash-only | 0 |
| Vendor plaintext/recoverable | 3 |
| Vendor hash-only | 0 |
| Management recoverable (`accessPinSecrets` revealable) | 0 |
| Management hash-only | 1 (`managementPins` doc with `pinHash`; `accessPinSecrets` empty) |
| Already migrated (`accessPinSecrets` docs) | 0 |
| Errors/malformed | 0 |

**Also:** `managementPinSecrets` legacy docs = **1** with `managementPinHash` configured (alongside registry).

## After CF deploy

1. Invoke `migrateAccessPins({ dryRun: true, limit: 200 })` via manager auth.
2. Confirm CF-side classification **matches** the REST inventory above.
3. Only after dryRun PASS and Dan approval: `migrateAccessPins({ dryRun: false, … })`.

Do **not** run mutating migration against prod until Dan approves deploy.

**Local/emulator fixtures:** none seeded in this PR — tests cover crypto, session helpers, and rules blocks only.

**Post-sync re-verify (2026-08-08):** D-43 UI/build evidence stamped after rebase — `verify:settings-pin-access` PASS; MERGEABLE+CLEAN.
