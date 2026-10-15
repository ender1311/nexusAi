export const DEMO_DB_HOST_MARKER = "ep-orange-star-b8ujtvot";

/**
 * Throws unless `url` points at the public demo DB (nexus-demo-db).
 * The hostname must be the marker itself or the marker followed by "-" or "."
 * (e.g. the "-pooler" host), must end with ".neon.tech", and the URL must not
 * carry a `host` or `hostaddr` param that could redirect the connection.
 */
export function assertDemoDatabase(url: string | undefined): string {
  if (!url) throw new Error("Set DEMO_DATABASE_URL to the nexus-demo-db connection string.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DEMO_DATABASE_URL is not a valid connection string.");
  }
  const host = parsed.hostname;
  const markerMatches =
    host === DEMO_DB_HOST_MARKER ||
    host.startsWith(`${DEMO_DB_HOST_MARKER}-`) ||
    host.startsWith(`${DEMO_DB_HOST_MARKER}.`);
  if (!markerMatches || !host.endsWith(".neon.tech")) {
    throw new Error(`Refusing to seed: ${host} is not the demo database.`);
  }
  if (parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr")) {
    throw new Error("Refusing to seed: DEMO_DATABASE_URL must not set a host or hostaddr param (not the demo database).");
  }
  return url;
}
