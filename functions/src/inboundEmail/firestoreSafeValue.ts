/** Remove undefined fields so Firestore Admin writes do not throw. */
export function firestoreSafeValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => firestoreSafeValue(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = firestoreSafeValue(entry);
    }
    return out as T;
  }
  return value;
}
