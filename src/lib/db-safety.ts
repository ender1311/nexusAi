// Guards that keep tests, scripts and the Prisma CLI off live databases.
//
// Pure module with no imports so prisma.config.ts, test preloads and scripts can
// load it via a relative path without the `@/` alias or the Prisma client.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalHostValue(host: string): boolean {
  return LOCAL_HOSTNAMES.has(host.toLowerCase()) || host.startsWith("/");
}

type ParsedDatabaseUrl = {
  hostname: string;
  hostParams: string[];
  hostaddrParams: string[];
};

function parseDatabaseUrl(url: string | undefined): ParsedDatabaseUrl | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  return {
    hostname: decodeURIComponent(parsed.hostname),
    hostParams: parsed.searchParams.getAll("host"),
    hostaddrParams: parsed.searchParams.getAll("hostaddr"),
  };
}

/**
 * True only for postgres(ql):// URLs that resolve to this machine: a localhost /
 * loopback authority, or a unix socket (empty authority + `host=/path`). pg honours
 * `host` / `hostaddr` query params over the authority, so any of those pointing
 * elsewhere makes the URL non-local. Malformed or missing URLs are non-local.
 */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return false;

  if (!parsed.hostaddrParams.every((addr) => LOCAL_HOSTNAMES.has(addr.toLowerCase()))) return false;
  if (!parsed.hostParams.every(isLocalHostValue)) return false;

  if (parsed.hostname === "") {
    // Unix-socket form: postgresql:///db?host=/var/run/postgresql
    return parsed.hostParams.length > 0;
  }
  return LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

/** The host a URL points at, for error messages. Never includes credentials. */
function describeHost(url: string | undefined): string {
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return "invalid url";
  const remoteParam = [...parsed.hostParams, ...parsed.hostaddrParams].find(
    (h) => !isLocalHostValue(h),
  );
  return remoteParam ?? (parsed.hostname || "no host");
}

export function assertLocalDatabase(url: string | undefined, context: string): void {
  if (isLocalDatabaseUrl(url)) return;
  throw new Error(
    `SAFETY ABORT (${context}): refusing to use a non-local database (${describeHost(url)}). ` +
      `Tests and destructive tools may only touch localhost.`,
  );
}

// Prisma CLI commands that change schema or data on the target database.
const DESTRUCTIVE_PRISMA_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["migrate", "dev"],
  ["migrate", "reset"],
  ["db", "push"],
  ["db", "execute"],
];

export const LIVE_DB_OVERRIDE_ENV = "ALLOW_LIVE_DB_SCHEMA_CHANGE";

/**
 * Decides whether prisma.config.ts should refuse to load for this CLI invocation:
 * a destructive command (migrate dev/reset, db push/execute) against a non-local
 * URL, without the explicit ALLOW_LIVE_DB_SCHEMA_CHANGE=1 override. `--help` is
 * always allowed since it never connects.
 */
export function shouldBlockPrismaCommand(
  argv: readonly string[],
  url: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (argv.includes("--help") || argv.includes("-h")) return false;
  const isDestructive = DESTRUCTIVE_PRISMA_COMMANDS.some(([group, sub]) =>
    argv.some((arg, i) => arg === group && argv[i + 1] === sub),
  );
  if (!isDestructive) return false;
  if (isLocalDatabaseUrl(url)) return false;
  return env[LIVE_DB_OVERRIDE_ENV] !== "1";
}
