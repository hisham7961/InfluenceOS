/**
 * A short in-process cache for heavy read-only reports (P2.7): the exec
 * overview and leaderboard recompute many aggregates, so repeated loads within
 * a minute reuse the answer. Keys include the reader, so scope never leaks
 * between people. ANALYTICS_CACHE_SECONDS=0 turns it off; tests never cache.
 */
const store = new Map<string, { expires: number; value: Promise<unknown> }>();
const MAX_ENTRIES = 500;

function ttlMs(): number {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return 0;
  const raw = process.env.ANALYTICS_CACHE_SECONDS;
  const seconds = raw === undefined || raw === '' ? 60 : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const ttl = ttlMs();
  if (!ttl) return fn();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (store.size >= MAX_ENTRIES) {
    for (const [k, v] of store) if (v.expires <= now) store.delete(k);
    if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  }
  const value = fn();
  store.set(key, { expires: now + ttl, value });
  // A failed computation is never served from the cache.
  value.catch(() => store.delete(key));
  return value;
}
