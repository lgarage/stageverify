# Invoice Review Inspection — S/O 4046362 (page-0)

**Date:** 2026-07-04  
**Scope:** Goal C inspection only — no parser/UI changes.  
**Probes run:** `node scripts/inspect-import-4046362.mjs`, `npx tsx scripts/inspect-fixture-4046362.mjs`, local `pdf-parse` on reference PDF, `processInvoicePage` on PDF extract.

---

## Production records (Firestore via callables)

| Path | Value |
|------|--------|
| `vendorInvoiceImports/vii-19f2d62d6949a928-page-0` | `pageId=page-0`, `importStatus=issue`, `reviewStatus=pending_review` |
| `inboundEmailProcessing/inbound-19f2d62d6949a928` | `processingStatus=parsed`, 1 review row queued |
| Attachment | `JS_Invoice_P411190_54632502.PDF` (2 pages, 3053 chars extracted) |
| Subject | `Fwd: S/O Confirmation 4046362 Cust P/O blackduck hartford` |
| Cached text | `combinedExtractedText` + `pdfAttachments[0].extractedText` (same blob) |

**No separate raw JSON blob** — only stored strings above plus `parseResult` summary on inbound doc.

### Production `parsedHeader` (actual)

All header fields empty except `vendorBranchName: "Johnstone Supply"` (parser default when `Remit To:` / `Johnstone Supply` regex miss). `parsedLines: []`, `parsedLineCount: 0`.

### Cached extracted text (actual)

Text is **not ASCII**. `pdf-parse` returns characters mapped to **U+XX00** (e.g. `'D'` → U+4400 `䐀`, `'4'` → U+3400 `㐀`, `'0'` → U+3000 ideographic space). Semantic content is present in encoded form (e.g. data row decodes to customer `0018114`, SO `4046362`, PO `blackduck hartford`) but **zero ASCII matches** for:

- `Customer #`, `Sales Order`, `4046362`, `LN QNTY ORD`, `L46-668`, etc.

Same garbled blob in Firestore matches local extraction of `c:\Users\daday\Downloads\JS_Invoice_P411190_54632502.PDF`.

---

## Fixture comparison (clean extraction)

Fixtures in `src/dispatcher/invoice/invoiceFixtures.ts` model **correct pdf-parse output** for S/O tabular/colon layouts — not this PDF’s encoding.

| Fixture | Parser @ HEAD (post-85e0276) |
|---------|------------------------------|
| `inv-so-4046362` (tabular) | Headers: acct `0018114`, SO `4046362`, PO `blackduck hartford`, order date, buyer, ship via, sold/ship to; **1 line** `L46-668` |
| `inv-so-4046362-colon` | Same core headers; **1 line**; sold/ship to absent from text (correctly empty) |
| Both | `importStatus=issue` (missing Invoice # — expected for S/O) |

---

## Answers

### 1. Expected fields in extracted text vs `parsedHeader`

**If extraction were clean (fixtures):**

| Field | In text? | Parsed (tabular fixture) |
|-------|----------|--------------------------|
| customerAccountNumber | yes (`0018114`) | yes |
| vendorOrderNumber | yes (`4046362`) | yes |
| customerPoOrReference | yes (`blackduck hartford`) | yes |
| orderDate | yes (`06/23/2026`) | yes |
| buyerName / shipViaRaw | yes | yes |
| soldToName / shipToName | yes (tabular) | yes |
| vendorInvoiceNumber | **no** (S/O doc) | empty |
| invoiceDate | no | empty |
| lineItems | yes | 1 line |

**Production page-0:** text has fields only in U+XX00 encoding → `parsedHeader` empty (except default branch name). **Mismatch is extraction encoding, not missing PDF content.**

### 2. PDF-missing vs parser-missed

| Verdict | Detail |
|---------|--------|
| **Not PDF-missing** | Reference PDF + cached text contain SO/account/PO/line data in U+XX00 encoding |
| **Not parser-missed (for clean text)** | Fixtures prove parser 85e0276 captures tabular S/O headers + lines |
| **Root cause** | **`pdf-parse` text extraction** — custom font / ToUnicode mapping yields U+XX00 instead of ASCII; parser regexes never fire |

### 3. Should `parsedLines` exist?

| Context | Expected |
|---------|----------|
| Clean S/O fixture (`inv-so-4046362`) | **Yes** — 1 line (`L46-668`) |
| This PDF if cleanly extracted | **Yes** — multi-line invoice (encoded lines include L97-535, L46-064, P33-330, etc. on 2 pages) |
| Production page-0 today | **No** (0 lines) — correct given garbled text; line header `LN QNTY ORD` not present as ASCII |

### 4. Issue status / approve block / reject

| Check | Production | Correct? |
|-------|------------|----------|
| `importStatus=issue` | yes | **Yes** — required fields empty + missing Invoice # |
| Approve blocked | UI + `approveVendorInvoiceImport` block on `issue` | **Yes** |
| Reject allowed | `pending_review` | **Yes** |

Issue/review gating is **working as designed** even though root problem is extraction, not business validation.

### 5. Headers empty after parser 85e0276 — reprocess failure vs text lacks fields

| Question | Answer |
|----------|--------|
| Would reparse fix it? | **No** — Refresh Now reprocess uses **cached** `combinedExtractedText` (same U+XX00 blob). `shouldReprocessExistingDoc` also skips this doc (already `parsed` with 1 review row). |
| Would redeployed parser fix it? | **No** — running `processInvoicePage` on the actual PDF extract locally reproduces production empty headers exactly. |
| Text lacks fields? | **Fields lack ASCII** — semantic data encoded U+XX00; parser cannot read without normalization or better extraction (OCR / alternate PDF library). |

**Conclusion:** Not a reprocess failure and not a 85e0276 regression on this artifact. **Extraction-layer gap** — out of scope for parser-only hardening.

---

## Recommended follow-up (report only — not implemented)

1. **Extraction:** investigate font/CMap handling (pdf.js, mutool, OCR) for Johnstone PDFs using U+XX00 mapping.
2. **Optional normalize:** pre-parser pass to fold U+XX00 → ASCII if pattern is stable (`charCode >> 8` for BMP letters/digits).
3. **Do not change parser** until clean ASCII extract exists or normalization is proven on this PDF.

---

## Probe commands

```bash
node scripts/inspect-import-4046362.mjs
npx tsx scripts/inspect-fixture-4046362.mjs
# PDF extract: pdf-parse on JS_Invoice_P411190_54632502.PDF (functions/node_modules)
```

**Verified against:** Firestore callables, reference PDF, fixtures, `processInvoicePage` on PDF extract, commit `85e0276`.
