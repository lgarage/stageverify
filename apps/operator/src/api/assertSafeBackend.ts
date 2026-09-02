import { isOperatorBackendMutationsAllowed } from "../firebase";

export class OperatorDevBackendBlockedError extends Error {
  constructor() {
    super(
      "Operator mutations are disabled in dev unless VITE_OPERATOR_USE_EMULATORS=1 with Auth/Functions emulators connected.",
    );
    this.name = "OperatorDevBackendBlockedError";
  }
}

export function assertSafeBackend(): void {
  if (!isOperatorBackendMutationsAllowed()) {
    throw new OperatorDevBackendBlockedError();
  }
}
