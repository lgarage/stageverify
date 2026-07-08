# Phase 1 — page-0 / S/O 4046362 inspection (2026-07-04)

**Production doc:** `vii-19f2d62d6949a928-page-0` · subject *Fwd: S/O Confirmation 4046362* · attachment `JS_Invoice_P411190_54632502.PDF`

## Root cause (not parser 85e0276)

| Layer | Finding |
| ----- | ------- |
| PDF extract | `pdf-parse` returns wide-char mojibake (~0% readable ASCII). Same on Dan's reference PDF locally. |
| Cached text | Firestore `inboundEmailProcessing` stores same garbled text — Refresh Now/backfill cannot fix without new extractor. |
| Parser fixtures | `inv-so-4046362` / `-colon` with clean text → full header + 1 line, `importStatus: issue` (missing Invoice #). |

## Production vs fixture

| Field | Fixture (clean S/O text) | Production page-0 |
| ----- | ------------------------ | ----------------- |
| vendorOrderNumber | 4046362 | empty (extract fail) |
| customerPoOrReference | blackduck hartford | empty |
| buyerName | CONNOR SMITH | empty |
| parsedLines | 1 (L46-668) | 0 |
| importStatus | issue ✓ | issue ✓ |
| Approve | blocked ✓ | blocked ✓ |
| Reject | allowed ✓ | allowed ✓ |

## Doc type

- Email subject = **S/O confirmation**; attachment filename = **invoice P411190** (mismatch).
- Garbled extract prevents identifying doc type from text; issue status still correct.

## Action

- **No parser/CF change** from this inspection — gap is PDF text extraction (future slice).
- UI should show issue summary + inspect modal explains extract/parse state for page-0.

Probe scripts: `scripts/inspect-import-4046362.mjs`, `scripts/inspect-fixture-4046362.mjs`
