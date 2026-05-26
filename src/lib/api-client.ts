const API_BASE = process.env.API_SERVICE_URL;
const API_SECRET = process.env.INTERNAL_API_SECRET;

type FetchOptions = RequestInit & {
  /** Participate in Next.js fetch cache with tag-based revalidation. */
  tags?: string[];
  /** Revalidate duration in seconds (used with tags). */
  revalidate?: number;
  /** Set to true when the caller has verified the current user is an admin. */
  isAdmin?: boolean;
  /** Request timeout in ms. Defaults to 5000 for reads; use 15000+ for write-heavy mutations. */
  timeout?: number;
};

/** Thrown by apiFetch when the API service returns a non-2xx response. Carries the upstream status code. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Authenticated fetch to the API service.
 * - tags/revalidate opt the response into the Next.js Data Cache.
 * - isAdmin adds X-User-Role: admin, enabling admin-gated mutations.
 * - Throws ApiError on non-2xx so callers can forward the upstream status code.
 */
export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  if (!API_BASE || !API_SECRET) {
    throw new Error("API_SERVICE_URL and INTERNAL_API_SECRET must be set");
  }

  const { tags, revalidate, isAdmin, timeout = 5000, ...init } = options;
  const hasBody = !!init.body;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeout),
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(hasBody && { "Content-Type": "application/json" }),
      "Authorization": `Bearer ${API_SECRET}`,
      ...(isAdmin && { "X-User-Role": "admin" }),
    },
    ...(tags && { next: { tags, ...(revalidate !== undefined && { revalidate }) } }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as Record<string, unknown>;
    throw new ApiError(res.status, String(body.error ?? `API service error ${res.status}`));
  }

  return res.json() as Promise<T>;
}
