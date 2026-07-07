# Security Gate Evidence Audit — 2026-07-07

> **Audit id:** `31758824-06be-486f-8c76-90e64c47d77e` (Sonnet/Fable evidence review, Jul 7 2026)  
> **Scope:** Process memory only — no product code, deploy, or Firestore writes from this audit.  
> **SSOT for gotchas:** `gotcha-map.json` trigger `security-gate-evidence`; lessons #27–30 in `LIBRARIAN_LESSONS.md`.

## Executive summary

Jul 4–7 vendor-email backend ships invoked real `security-review` Task subagents and recorded valid `security-gate-id` UUIDs in completion reports. **Actual Sonnet 4.6 model execution remains unverifiable from logs (RC-3).** Fable 5 never ran (data retention policy block). Historical `away-status.json` rows that say "Sonnet PASS" without a `security-gate-id` or transcript are **checklist-only** — not independent model review.

**Future rule:** Do not claim "Sonnet PASS" or "Fable verdict" without invocation evidence. Use the reporting standard below.

---

## Four review types (do not conflate)

| Type | What it is | Counts as security gate? | Evidence |
|------|------------|--------------------------|----------|
| **Actual independent model review** | A separate model instance (e.g. Sonnet 4.6) ran on the diff and returned a verdict | Yes — **if** model execution is verified or explicitly labeled unknown | Task transcript + model billing/logs when available |
| **security-review subagent transcript** | Composer spawned `Task({ subagent_type: "security-review", model: "claude-4.6-sonnet-medium-thinking", … })` and received a UUID + verdict block | Yes for **subagent invocation**; model execution may still be **unknown** (RC-3) | `security-gate-id` from Task return + agent transcript path |
| **Composer / checklist review** | Orchestrator read the diff inline, followed ship-loop checklist, or copied "Sonnet PASS" from habit | **No** — treat as NOT RUN for CF/auth/rules push | No Task UUID; no subagent transcript |
| **Unverifiable model execution** | Subagent invoked with correct params but logs cannot prove Sonnet 4.6 ran (RC-3) | Partial — blocks claiming **independent Sonnet** review; subagent transcript still valid for process audit | Report `actual model invocation evidence: unknown` |

### RC-1 (cosmetic UI label)

Parent timeline may show **"Security Review — Composer 2.5 Fast"** while the gate runs. That label reflects the orchestrator session, not the child subagent. Validity = `security-gate-id` + claimed model line + verdict — not the parent UI label.

### RC-3 (model execution unverified)

Cursor Task return does not expose which model executed inside `security-review`. Until Dan confirms otherwise, completion reports must note **`model execution: unverified`** when claiming Sonnet — subagent invocation can still be **yes** with evidence path.

---

## Reporting standard (mandatory for future security gates)

Paste this block in every ship report when `backend-write-critical`, CF, Firestore rules, or auth changes trigger the gate:

```yaml
security_gate_id: <uuid from Task return — lowercase hex 8-4-4-4-12>
reviewer/subagent: security-review | generalPurpose (fallback only if Dan-approved) | Composer-inline (NOT RUN)
claimed model: claude-4.6-sonnet-medium-thinking | other | n/a
actual model invocation evidence: yes | no | unknown
evidence path or transcript: <agent transcript id/path, or "none">
verdict: PASS | MEDIUM | HIGH | NOT RUN
limitations: <e.g. RC-3 unverified execution, merged commit empty branch diff>
production decision affected: yes | no
```

### Field rules

- **`security_gate_id`** — missing or non-UUID → verdict **NOT RUN**; do not push CF/auth/rules.
- **`actual model invocation evidence: yes`** — only when logs/billing/transcript explicitly show Sonnet (or approved verifier model) ran. Otherwise **unknown** (RC-3 default) or **no** (Composer-only).
- **`evidence path or transcript`** — link or id for the subagent turn; `none` for checklist-only.
- **`production decision affected`** — `yes` when the verdict influenced deploy, flag flip, or pilot go/no-go.

---

## Jul 4–7 vendor-email gate findings

| Finding | Status |
|---------|--------|
| Composer 2.5 can spawn `security-review` Task subagents | **Confirmed** |
| Jul 4–7 vendor-email gates have subagent transcripts + `security-gate-id` | **Confirmed** (see `PROJECT_STATUS/security-scan-2026-07-04-invoice.md` and ship reports in session logs) |
| Actual Sonnet 4.6 model execution | **Unverified** (RC-3) |
| Fable 5 (`claude-fable-5-thinking-high`) | **Never ran** — data retention policy block on transcript access |
| Historical `away-status.json` "Sonnet PASS" without UUID | **Checklist-only** — not independent review evidence |

---

## Vendor email production impact (behavior vs review evidence)

**Behavior tests (controlled pilot):**

- Controlled reply ingest behavior tests **passed** (matched thread → Needs Review tier; no delivery mutation).
- Wrong-thread negative test **passed**.
- Safe for **controlled testing** based on behavior tests while `emailReplyIngestEnabled` remains a Dan-controlled flag.

**Review evidence gap:**

- Independent Sonnet model execution for vendor-email CF/rules changes **remains unverified** (RC-3).
- Before a **real vendor pilot** (beyond controlled test account): require **verified independent review** OR explicitly label the ship as **checklist/subagent-only** with `actual model invocation evidence: unknown` and `production decision affected: yes` documented.

Do **not** infer security from "Sonnet PASS" strings in `away-status.json` without matching `security-gate-id` + transcript.

---

## Gotchas (indexed)

1. **Do not write "Sonnet PASS"** unless actual Sonnet model invocation evidence is available — subagent UUID alone is necessary but not sufficient for "independent Sonnet reviewed."
2. **Fable 5 must be an explicit Task** with model slug — "Fable-style" or narrative review ≠ Fable 5 verdict.
3. **Merged-on-main empty branch diff** — use `git diff <commit>^..<commit>` for gate scope (lesson #10).
4. **Checklist PASS ≠ security gate** — Composer inline or away-status note without Task UUID = NOT RUN.

---

## References

- `.cursor/rules/security-review-gate.mdc` — invocation template, RC-1/RC-3
- `.cursor/rules/model-audit-gate.mdc` — ship-loop integration
- `PROJECT_STATUS/gotcha-map.json` — triggers `security-gate`, `sonnet-gate`, `security-gate-evidence`
- `PROJECT_STATUS/LIBRARIAN_LESSONS.md` — lessons #27–30
- `PROJECT_STATUS/HANDOFF_VENDOR_EMAIL_2026-07-07.md` — controlled pilot handoff
