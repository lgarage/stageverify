/**
 * Teach-chat helpers for "ignore future CREDIT/returns" consent UX.
 */
import { correctionNoteTeachesIgnoreCreditReturns } from "./creditReturnSkip";

export type TeachChatPhase = "idle" | "pending_confirm" | "clarifying";

export type TeachIntent =
  | { kind: "ignore_credit_returns"; echo: string }
  | { kind: "ambiguous"; echo: string }
  | { kind: "playbook_lesson" };

export function isTeachConsentYes(text: string): boolean {
  return /^\s*(yes|y|yeah|yep|confirm|confirmed|that's right|thats right|correct|ok|okay)\s*\.?$/i.test(
    text.trim(),
  );
}

export function isTeachConsentNo(text: string): boolean {
  return /^\s*(no|n|nope|cancel|never\s*mind|nevermind)\s*\.?$/i.test(
    text.trim(),
  );
}

export function interpretTeachNote(
  note: string,
  vendorDisplayName: string,
): TeachIntent {
  const trimmed = note.trim();
  if (!trimmed) return { kind: "playbook_lesson" };

  const vendor =
    vendorDisplayName.trim() || "this vendor";

  if (correctionNoteTeachesIgnoreCreditReturns(trimmed)) {
    return {
      kind: "ignore_credit_returns",
      echo: `I think you mean: automatically skip future CREDIT/return memos for ${vendor} so they don't need review. Reply yes to confirm.`,
    };
  }

  if (
    /\b(ignore|skip|dismiss)\b/i.test(trimmed) &&
    /\b(these|this|those|kind|type|email|invoice|memo|from now on|future|always)\b/i.test(
      trimmed,
    )
  ) {
    return {
      kind: "ambiguous",
      echo: `I can auto-skip CREDIT/return memos for ${vendor} from now on. Reply yes to confirm that, or rephrase with a clearer pattern.`,
    };
  }

  return { kind: "playbook_lesson" };
}
