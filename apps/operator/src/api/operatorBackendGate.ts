/** Pure DEV fail-closed gate — no import.meta.env here (testable in Node). */
export function isOperatorBackendAllowed({
  isDev,
  useEmulators,
}: {
  isDev: boolean;
  useEmulators: boolean;
}): boolean {
  if (!isDev) return true;
  return useEmulators === true;
}
