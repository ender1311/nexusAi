/**
 * Calls the Next.js revalidate webhook to invalidate a named cache tag.
 * Non-fatal: if Next.js is unreachable the cache will expire on its own TTL.
 */
export async function revalidate(tag: string): Promise<void> {
  const url = process.env.NEXT_APP_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) {
    console.warn(`[revalidate] NEXT_APP_URL or REVALIDATE_SECRET not set — skipping tag "${tag}"`);
    return;
  }
  try {
    const res = await fetch(`${url}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, secret }),
    });
    if (!res.ok) {
      console.warn(`[revalidate] webhook returned ${res.status} for tag "${tag}"`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[revalidate] webhook call failed for tag "${tag}": ${msg}`);
  }
}
