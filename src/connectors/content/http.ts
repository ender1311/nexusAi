export async function fetchJson(url: string, init: { headers: Record<string, string> }, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(url, { method: "GET", headers: init.headers, signal: AbortSignal.timeout(10_000) });
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

/** Shared helper: split mapped results into items and skipped. */
export function partition<T>(results: ({ item: T } | { error: string; ref: string })[]) {
  const items: T[] = [];
  const skipped: { externalRef: string; error: string }[] = [];
  for (const r of results) "item" in r ? items.push(r.item) : skipped.push({ externalRef: r.ref, error: r.error });
  return { items, skipped };
}
