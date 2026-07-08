# Librarian lessons — archive

Rotated entries from `PROJECT_STATUS/LIBRARIAN_LESSONS.md` when the active log exceeds ~40 lines.

---

## Rotation 2026-07-08 (Harness Cleanup Phase 1)

### Jul 3 2026 session

- **Stale gh-pages:** code at b2e60af, prod still on 12044c2 until redeploy — prod verify caught it (lesson #1).
- **Staging rows + short clipboard** shipped same session (lessons #4–5).
- **Dan-to-done timing** + estimate-log subtype taxonomy — timing SSOT in estimate-log only.
- **2-fail Sonnet escalation** rule shipped (replaced 3-fail); lesson #7.

### Jul 4 2026 session

- **Invoice review vs Needs Review:** agents confused offline email fixtures with `vendorInvoiceImports` — lessons #15–16.
- **Gmail sync banner vs invoice queue:** processed/skipped counts from `inboundEmailProcessing`, not import rows — lesson #16.
- **Dispatcher Refresh Now:** shared `refreshAll()` across tabs, not per-page fetch — lesson #17.
- **Chrome extension console noise:** not SV bugs — lesson #18.

### Jul 7 2026 session

- **Vendor reply ingest overnight audit:** flag ON for controlled pilot; push ingest broken; poll/manual sync works; gotcha-map triggers vendor-reply-ingest-pilot / gmail-push-payload / gmail-sync-404-noise / vendor-email-test-account — lessons #21–26.
- **Security gate evidence audit:** `PROJECT_STATUS/archives/SECURITY_GATE_AUDIT_2026-07-07.md`; gotcha `security-gate-evidence`; lessons #27–30 — do not claim Sonnet/Fable without invocation evidence; RC-3 model execution unverified.

### Archived vendor-email specifics (merged into active rules #22–25)

- **Sync 404 noise:** Gmail message `19f3a2e9dfccab1e` 404 on every manual sync is orphan history noise — not a reply-ingest blocker.
- **Test email accounts:** `test@stageverify.dev` has no MX — never use for ingest tests; prod Playwright uses `STAGEVERIFY_TEST_EMAIL`; bot inbox is `svbotmail@gmail.com`.
- **Vendor email security evidence:** controlled behavior + wrong-thread negative tests passed — safe for controlled testing; independent Sonnet model execution for CF/rules ships **unverified** (RC-3). Before real vendor pilot: verified independent review OR label ship checklist/subagent-only with `production decision affected: yes`.

### Archived invoice/parser specifics

- **Johnstone S/O 4046362 / U+XX00:** tabular header parsing; pdf-parse custom-font encoding; issue-import when Invoice # missing; Approve blocked server+UI.

### Archived ship/verify dash-bullet (merged into active rule #1)

- gh-pages branch push ≠ live: npm run deploy must wait for GitHub Pages build status built (legacy build can error after push succeeds).

### Archived process/agents dash-bullets (merged into active rules #13, #21)

- **Lessons index + slice CLI:** type/subtype maps to LIBRARIAN_LESSONS section; away:validate fails on index drift; gotcha prepends matched section.
- **Fable 5 explicit Task only** — `model: claude-fable-5-thinking-high` via Task; "Fable-style" narrative review ≠ Fable 5 verdict; Fable never ran in Jul 7 audit (retention block).
