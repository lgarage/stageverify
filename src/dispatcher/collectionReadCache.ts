/**
 * Short-lived in-flight + TTL cache for bursty dispatcher reads.
 * Concurrent callers share one loader; a second burst within TTL reuses the result.
 */

export const DISPATCHER_READ_CACHE_TTL_MS = 4_000;

type CacheEntry<T> = { at: number; value: T };

export function isReadCacheFresh(
  fetchedAtMs: number,
  nowMs: number,
  ttlMs: number = DISPATCHER_READ_CACHE_TTL_MS,
): boolean {
  return nowMs - fetchedAtMs < ttlMs;
}

export function createCollectionReadCache(ttlMs: number = DISPATCHER_READ_CACHE_TTL_MS) {
  const values = new Map<string, CacheEntry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();

  async function read<T>(
    key: string,
    loader: () => Promise<T>,
    options?: { bypass?: boolean; nowMs?: number },
  ): Promise<T> {
    const nowMs = options?.nowMs ?? Date.now();
    if (options?.bypass) {
      values.delete(key);
      inflight.delete(key);
    } else {
      const cached = values.get(key) as CacheEntry<T> | undefined;
      if (cached && isReadCacheFresh(cached.at, nowMs, ttlMs)) {
        return cached.value;
      }
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;
    }

    const pending = loader()
      .then((value) => {
        values.set(key, { at: Date.now(), value });
        inflight.delete(key);
        return value;
      })
      .catch((err: unknown) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, pending);
    return pending as Promise<T>;
  }

  function invalidate(key?: string): void {
    if (key) {
      values.delete(key);
      inflight.delete(key);
      return;
    }
    values.clear();
    inflight.clear();
  }

  return { read, invalidate, ttlMs };
}

export const dispatcherReadCache = createCollectionReadCache();

export function invalidateDispatcherReadCache(key?: string): void {
  dispatcherReadCache.invalidate(key);
}
