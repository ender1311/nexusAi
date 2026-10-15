export const DEMO_DB_HOST_MARKER = "ep-orange-star-b8ujtvot";

/** Throws unless `url` points at the public demo DB (nexus-demo-db). Checks the host, not the whole string. */
export function assertDemoDatabase(url: string | undefined): string {
  if (!url) throw new Error("Set DEMO_DATABASE_URL to the nexus-demo-db connection string.");
  const host = new URL(url).hostname;
  if (!host.startsWith(DEMO_DB_HOST_MARKER)) throw new Error(`Refusing to seed: ${host} is not the demo database.`);
  return url;
}
