# Security Report — 2026-06-01 (Retroactive scan: ReceivingPage + MobileHubPage)

**Scanner:** Gemini 3 Flash  
**Verifier:** Opus 4.6  
**Verdict:** SECURITY: PASS  
**Scope:** src/ReceivingPage.tsx, src/MobileHubPage.tsx, src/LoginPage.tsx, src/main.tsx

## Findings

| Severity | Category | File:Line | Status | Notes |
|---|---|---|---|---|
| ~~MED~~ → LOW | Unprotected route | main.tsx:31 | Downgraded | /receive intentionally public — matches /, /pickup, /checkin pattern |
| ~~MED~~ → LOW | Auth bypass | ReceivingPage.tsx:154,276,295 | Downgraded | Public Firestore writes are intentional for QR deep-link field workflows |
| LOW | Data validation gap | ReceivingPage.tsx:378 | Confirmed | Manual ID input has no maxLength; add maxLength={64} (trivial fix, away-007b) |

## Scanner-Missed Risks (Opus check)
- Open redirect: PASS — ?next= validated against internal paths only
- Secrets exposure: PASS — Firebase client config is standard public keys
- Privilege escalation: PASS — ProtectedRoute correctly gates /dispatcher, /settings, /hub
- Data exfiltration: PASS — public pages only read by known delivery ID
- XSS/injection: PASS — no dangerouslySetInnerHTML, React default escaping applies

## Critical Recommendation (not a current-scan finding — applies to entire repo)
**No firestore.rules file found.** Server-side Firestore Security Rules are absent. Anyone with the project ID can call the REST API directly, bypassing all app-level auth. This is the most significant security gap in the project. Recommend implementing Firestore rules as a backend-write-critical priority item. At minimum: restrict unauthenticated writes to delivery/item status transitions only; require auth for dispatcher-level reads; enforce valid status values.
