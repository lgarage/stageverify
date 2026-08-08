# Access PIN migration inventory

**Status (2026-08-08 ops — authoritative):**

| Phase | Status |
| --- | --- |
| **Phase 1** (secrets / rules / indexes / CF surface) | **COMPLETE** — PR #56 merge `f96afafa`; `ACCESS_PIN_ENCRYPTION_KEY` v2 ENABLED (v1 DISABLED) |
| **Phase 2** (`migrateAccessPins` live) | **COMPLETE** — migrated 6 (tech 2, vendor 3, mgmt hash-only 1); post-migration auth PASS |
| **Dual-read hotfixes** | **COMPLETE** — PR #58 `8b449d4c` |
| **Admin Access UI** | **LIVE** since v0.0.240 |
| **PIN length 4–6** | **LIVE** since v0.0.241 (PR #59 merge `6947cb92` + CF deploy) |

Do **not** remigrate, redo Phase 1, or mutate production PIN values for format testing.

## Historical REST snapshot (pre-migration — superseded)

**Collected:** 2026-08-08 — Firestore REST via `FIREBASE_TOKEN` (read-only scan). Superseded by Phase 2 live migration.

| Category | Count |
| --- | ---: |
| Technician plaintext/recoverable | 2 |
| Technician hash-only | 0 |
| Vendor plaintext/recoverable | 3 |
| Vendor hash-only | 0 |
| Management recoverable (`accessPinSecrets` revealable) | 0 |
| Management hash-only | 1 |
| Already migrated (`accessPinSecrets` docs) | 0 (pre-migration) |
| Errors/malformed | 0 |

**Post Phase 2:** secrets revealable = 5; management remains non-revealable (hash-only).

## PIN length contract (LIVE)

Numeric only, **min 4 / max 6** — tech, vendor, management, job-scoped vendor. Existing 4-digit PINs remain valid.
