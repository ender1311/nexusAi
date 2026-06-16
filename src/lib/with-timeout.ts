/**
 * Resolve to `fallback` if `promise` doesn't settle within `ms`. Keeps a page
 * responsive when a cached aggregate is recomputing on a cold cache and the
 * underlying query is slow — the page renders with a safe fallback instead of
 * blocking to the function timeout (504). The original promise keeps running so
 * a value can still land in the cache for the next request.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
