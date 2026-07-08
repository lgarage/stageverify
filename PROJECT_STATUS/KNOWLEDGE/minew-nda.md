# Minew NDA — legal detail & compliance reference

> **Binding hard stops** live in `.cursor/rules/product-guardrails.mdc`. This file holds legal/operational detail.

**Authority:** NDA with Shenzhen Minew Technologies + Minew's written clarifications (Jun 2026). Architecture context: `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` (placeholders only — never paste received API docs there).

## What StageVerify owns (always OK in repo)

- All StageVerify source, schemas, UI, QR routing (`receiveQrUrls.ts`, `EslQrCode.tsx`)
- Public Minew **product model names** (e.g. DS042Q, DS035Q) — marketed publicly
- Your shop's **physical tag barcodes** (`eslTagId`, `entrywayEslTagId`) — operational mapping to hardware you own
- Speculative integration **placeholders** (TBD base URL, env var names) — not copies of Minew API documentation

## End users and customers (no Minew NDA required)

- Vendors, technicians, and customers use **StageVerify** URLs and flows only — not Minew's API.
- Do not require StageVerify users to sign Minew's NDA.
- Do not expose Minew API docs, credentials, or login interfaces in public routes (`/receive`, `/pickup`, `/checkin`, vendor PIN).

## ESL / Phase 7 implementation rules

When Minew credentials arrive:

1. **Server-side only** — Minew HTTP calls live in Cloud Functions (`functions/src/`), never in `src/` client code.
2. **Secrets** — `MINew_API_KEY`, base URL, and login URL in Firebase Functions secrets / environment config — never hardcoded, never in `firebase.ts`, never in client bundles.
3. **No API docs in repo** — implement from private docs; code comments describe behavior, not Minew endpoint/auth details.
4. **Contractors** — anyone receiving Minew confidential material needs written confidentiality obligations before access (NDA item 5).
5. **Trigger pattern** — Firestore `onDocumentWritten` → look up `eslTagId` → push label content server-side (see ESL plan).

## AI-assisted development (Cursor et al.)

| OK in cloud AI context | Never upload to cloud AI |
|------------------------|--------------------------|
| StageVerify integration code in this repo | Minew login URL / platform domain |
| Public product model names | Default passwords |
| Your `eslTagId` values (your hardware) | Production API keys or private keys |
| Redacted pseudocode ("POST to vendor API with secret from env") | Full Minew API documentation or authenticated example requests |

Prefer locally deployed models when working directly from Minew confidential docs. If unsure, redact.

## Copies, git history, and agreement end

- Reasonable copies of API docs for dev/test/security/backup are allowed **outside public git**, subject to NDA confidentiality.
- Git may retain backups/source history per NDA carve-out — but **must not contain** Minew confidential material.
- Confidentiality survives **5 years** from disclosure; trade secrets longer.
- On Minew request or purpose completion: destroy/return Minew docs from private storage; retained backups stay confidential and unused except compliance/records.

## Agent pre-ship checklist (Minew/ESL touches)

Before commit when work touches ESL, Minew, `eslTagId`, or Phase 7:

- [ ] `git diff` contains no Minew API keys, login URLs, default passwords, or pasted API documentation
- [ ] No new Minew HTTP calls in `src/` (client)
- [ ] No files under `minew-confidential/` staged
- [ ] Public routes still use StageVerify QR URLs only
- [ ] `PROJECT_STATUS/ESL_INTEGRATION_PLAN.md` still has placeholders only — no received Minew spec text
