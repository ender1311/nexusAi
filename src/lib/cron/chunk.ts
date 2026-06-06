// Split an array into consecutive batches of at most `size` items. Used to
// bound the fan-out of parallel DB writes in the cron run (a single agent with
// thousands of persona×variant arms or claimed users would otherwise open an
// unbounded number of concurrent connections in one Promise.all).
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Run `fn` over every item with at most `size` promises in flight at a time,
// awaiting each batch before starting the next. Preserves result order.
export async function runChunked<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (const batch of chunk(items, size)) {
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}
