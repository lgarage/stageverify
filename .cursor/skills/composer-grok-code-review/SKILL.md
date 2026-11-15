---
name: composer-grok-code-review
description: After Composer edits StageVerify files, have Grok 4.7 review the diff and iterate until VERDICT PASS. Use when Composer changes code, before calling the edit done. Model slug grok-4.7-high (effort High, Fast off, context 256k).
---

# Composer code, then Grok

Composer writes the code. Grok 4.7 reviews it. They repeat until Grok is satisfied.

## When to use

Use this after Composer changes files and before the task is called done. A question that does not change files uses the research skill only when that skill applies.

## Loop

1. Launch the `composer-diff-review` subagent. Its model is `grok-4.7-high`: Grok 4.7, effort High, Fast off, context 256k. It is read-only. Give it the git diff.
2. Wait for the full reply. The first line is `VERDICT: PASS` or `VERDICT: FAIL`.
3. `VERDICT: PASS` means Grok is satisfied. Stop the loop.
4. `VERDICT: FAIL` means Grok is not satisfied. Apply every item in the list, save the edits, then launch the same subagent on the updated diff.
5. Repeat until PASS. After 6 reviews without a pass, stop and report the remaining defects. Do not launch another review.

If a message starts with `GROK_REVIEW_LOOP`, follow that message. It is this same loop. Do not start a second review in that turn.

## Rules

- The fast slug `grok-4.7-high-fast` does not count. Do not turn Fast on. Context stays 256k.
- Do not treat your own reading of the diff as Grok's review.
- Do not edit, commit, push, or deploy during the review.
- This loop is the accuracy second look. Rules, auth, PIN, roles, and billing still need the recorded HIGH review and Sonnet backup from `.cursor/rules/lean-agent-process.mdc`.
