import { isOperatorBackendAllowed } from "../firebase";

export class OperatorDevBackendBlockedError extends Error {
  constructor() {
    super(
      "Operator backend (reads and writes) blocked in DEV unless emulators.",
    );
    this.name = "OperatorDevBackendBlockedError";
  }
}

export function assertSafeBackend(): void {
  if (!isOperatorBackendAllowed()) {
    throw new OperatorDevBackendBlockedError();
  }
}
