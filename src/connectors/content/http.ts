import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export async function fetchJson(url: string, init: { headers: Record<string, string> }, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(url, { method: "GET", headers: init.headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (res.status >= 300 && res.status < 400) throw new Error("Content endpoint redirected; redirects are not followed");
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

/** Narrows a parsed 200 body to an object, or throws a clear error naming the source. */
export function requireJsonObject(json: unknown, label: string): Record<string, unknown> {
  if (json === null || typeof json !== "object") throw new Error(`${label} returned a non-JSON response`);
  return json as Record<string, unknown>;
}

/** Shared helper: split mapped results into items and skipped. */
export function partition<T>(results: ({ item: T } | { error: string; ref: string })[]) {
  const items: T[] = [];
  const skipped: { externalRef: string; error: string }[] = [];
  for (const r of results) {
    if ("item" in r) items.push(r.item);
    else skipped.push({ externalRef: r.ref, error: r.error });
  }
  return { items, skipped };
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  const mapped = v.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1]!;
    if (isIP(rest) === 4) return isPrivateIPv4(rest);
    const hex = rest.split(":").map((h) => parseInt(h, 16));
    if (hex.length === 2 && hex.every((n) => !Number.isNaN(n))) {
      return isPrivateIPv4(`${hex[0]! >> 8}.${hex[0]! & 255}.${hex[1]! >> 8}.${hex[1]! & 255}`);
    }
    return true;
  }
  const first = parseInt(v.split(":")[0] || "0", 16);
  return (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00;
}

function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 4 ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

export type LookupImpl = (host: string, opts: { all: true }) => Promise<{ address: string }[]>;

/** Blocks SSRF: only public https hosts. Resolves the hostname and rejects any private address. */
export async function assertPublicHttpsUrl(url: string, lookupImpl: LookupImpl = dnsLookup): Promise<void> {
  const fail = () => new Error("Content URL must be public https");
  let u: URL;
  try { u = new URL(url); } catch { throw fail(); }
  if (u.protocol !== "https:") throw fail();
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw fail();
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw fail();
    return;
  }
  let addrs: { address: string }[];
  try { addrs = await lookupImpl(host, { all: true }); } catch { throw fail(); }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw fail();
}
