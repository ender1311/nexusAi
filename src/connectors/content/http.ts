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
  const [a, b, c] = ip.split(".").map(Number) as [number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    a >= 224 || // multicast and reserved
    (a === 100 && b >= 64 && b <= 127) || // CGNAT (includes 100.100.100.200)
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24, 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Expands any valid IPv6 text form (including a dotted-quad tail) to eight 16-bit groups. */
function ipv6Groups(ip: string): number[] {
  let v = ip.toLowerCase();
  const dotted = v.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number) as number[];
    v = v.slice(0, dotted.index) + `${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const [head = "", tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array<string>(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

function isPrivateIPv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (g.length !== 8 || g.some((n) => Number.isNaN(n))) return true;
  const embeddedV4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(6)) return true; // ::, ::1, IPv4-compatible (::7f00:1)
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4); // IPv4-mapped
  if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return true; // SIIT ::ffff:0:0/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return true; // NAT64
  return (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xfe00) === 0xfc00; // link-local, unique-local
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
