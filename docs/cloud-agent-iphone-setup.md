# iPhone / Cursor Cloud Agent setup (Dan checklist)

Short steps to make StageVerify buildable from Cursor Cloud Agents on iPhone.

## 1. Get bootstrap files on a branch

Merge the PR (or ensure branch includes `.cursor/environment.json`, `AGENTS.md`, and `scripts/verify-cloud-env.mjs`).

## 2. Create or update the Cursor environment

1. Open [cursor.com/agents](https://cursor.com/agents) → **Environments**.
2. Create/save an environment for **`lgarage/stageverify`**, or start a Cloud Agent from the branch so `.cursor/environment.json` **install** runs (`npm ci` + Playwright Chromium).

## 3. Add secrets (dashboard only — never in git)

| Secret | Required |
|--------|----------|
| `STAGEVERIFY_TEST_EMAIL` | Yes — Playwright protected routes |
| `STAGEVERIFY_TEST_PASSWORD` | Yes |
| `FIREBASE_TOKEN` | Optional — only if deploying CF/rules from cloud |

## 4. Save environment snapshot

After the first successful install completes, **save snapshot** so future agents skip cold `npm ci` when unchanged.

## 5. Run from iPhone

Start a **Cloud Agent** on that environment for branch work, reviews, and verifies.

For the full ship-loop (push to `main`, `npm run deploy`, prod `:prod` verifies), use **Remote Control** on your Mac unless the prompt explicitly allows cloud push/deploy.

## 6. Verify readiness

In the agent terminal:

```bash
npm run verify:cloud-env
```

Expect PASS on repo config; secrets PASS only after step 3. Then run `node scripts/playwright-auth-setup.mjs` before protected-route Playwright scripts.

## Repair requests (mobile / cloud parity)

When Dan asks to **repair**, **fix**, **debug**, **try again**, or **correct this**, the agent follows `model-gates.mdc` § Repair loop — same as desktop: higher-tier verifier (Grok default) → Composer fix → same verifier re-verify until PASS (max 3 cycles). Completion reports must include `repair-verifier:` and `fix-verified:` lines; Composer never self-closes on iPhone or cloud VM.
