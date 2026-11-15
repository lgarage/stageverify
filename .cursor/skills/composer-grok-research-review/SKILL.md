---
name: composer-grok-research-review
description: When researching how StageVerify can be updated, changed, improved, or fixed, have Grok 4.7 give a second look and iterate until VERDICT PASS. Use for research, investigation, and recommendations, including when no files change. Model slug grok-4.7-high (effort High, Fast off, context 256k).
---

# Research, then Grok

Research about how to update the program uses the same loop as a code edit. Composer writes the answer. Grok 4.7 reviews it. Composer revises. Grok reviews the revision until satisfied.

## When to use

Use this when the task is research, an investigation, or a recommendation about how the program, app, or repo can be updated, changed, improved, or fixed. Use it even when no file changes. A normal question that is not about updating the program does not use this skill.

## Loop

1. Write the research answer first. Name the files a later change would touch and the change you recommend.
2. Launch the `composer-diff-review` subagent. Its model is `grok-4.7-high`: Grok 4.7, effort High, Fast off, context 256k. It is read-only. Give it the research answer. There may be no git diff.
3. Wait for the full reply. The first line is `VERDICT: PASS` or `VERDICT: FAIL`.
4. `VERDICT: PASS` means Grok is satisfied. Stop the loop.
5. `VERDICT: FAIL` means Grok is not satisfied. Revise the research so every item in the list is fixed. Update code only when the list says to change a file. Then launch the same subagent on the revised answer.
6. Repeat until PASS. After 6 reviews without a pass, stop and report the remaining defects. Do not launch another review.

If a message starts with `GROK_REVIEW_LOOP`, follow that message. It is this same loop. Do not start a second review in that turn.

## Rules

- The fast slug `grok-4.7-high-fast` does not count. Do not turn Fast on. Context stays 256k.
- Do not treat your own draft as Grok's second look.
- Do not edit, commit, push, or deploy during the review.
- This loop is the accuracy second look. Rules, auth, PIN, roles, and billing still need the recorded HIGH review and Sonnet backup from `.cursor/rules/lean-agent-process.mdc`.
