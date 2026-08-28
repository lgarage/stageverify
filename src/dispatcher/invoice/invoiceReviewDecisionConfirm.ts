export type DecisionConfirmKind = "approve" | "reject" | null;

export type DecisionConfirmEvent =
  | "tap-approve"
  | "tap-reject"
  | "cancel"
  | "confirm";

export type DecisionConfirmFire = "approve" | "reject";

export interface DecisionConfirmReduceResult {
  next: DecisionConfirmKind;
  fire?: DecisionConfirmFire;
}

export interface DecisionConfirmOptions {
  locked?: boolean;
}

/**
 * Pure state machine for invoice review approve/reject confirmation.
 * tap-* while idle → show confirm (no fire). confirm → fire once and reset.
 */
export function reduceDecisionConfirm(
  current: DecisionConfirmKind,
  event: DecisionConfirmEvent,
  options: DecisionConfirmOptions = {},
): DecisionConfirmReduceResult {
  if (options.locked) {
    return { next: current };
  }

  switch (event) {
    case "tap-approve":
      if (current !== null) {
        return { next: current };
      }
      return { next: "approve" };

    case "tap-reject":
      if (current !== null) {
        return { next: current };
      }
      return { next: "reject" };

    case "cancel":
      return { next: null };

    case "confirm":
      if (current === "approve") {
        return { next: null, fire: "approve" };
      }
      if (current === "reject") {
        return { next: null, fire: "reject" };
      }
      return { next: current };

    default:
      return { next: current };
  }
}
