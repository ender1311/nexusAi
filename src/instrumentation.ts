export async function register() {
  // Only run on the Node.js server runtime, not edge workers
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Required — app cannot function without these
  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is not set — database connections will fail");
  }
  if (!process.env.CRON_SECRET) {
    errors.push("CRON_SECRET is not set — all cron routes will return 401");
  }
  if (!process.env.HIGHTOUCH_API_KEY && !process.env.INGEST_API_KEY) {
    errors.push(
      "Neither HIGHTOUCH_API_KEY nor INGEST_API_KEY is set — ingest routes will reject all requests"
    );
  }

  // Auth — warn if missing (WorkOS config)
  if (!process.env.WORKOS_API_KEY) {
    warnings.push("WORKOS_API_KEY is not set — SSO authentication will fail");
  }
  if (!process.env.WORKOS_CLIENT_ID) {
    warnings.push("WORKOS_CLIENT_ID is not set — SSO authentication will fail");
  }
  if (!process.env.WORKOS_COOKIE_PASSWORD) {
    warnings.push(
      "WORKOS_COOKIE_PASSWORD is not set — session cookies cannot be encrypted"
    );
  }

  // Braze — warn only (app runs without Braze, sends are skipped gracefully)
  const hasBrazeKey = !!process.env.BRAZE_API_KEY;
  const hasBrazeUrl = !!(
    process.env.BRAZE_REST_ENDPOINT ?? process.env.BRAZE_REST_URL
  );
  if (!hasBrazeKey || !hasBrazeUrl) {
    warnings.push(
      `Braze not fully configured (${[
        !hasBrazeKey && "BRAZE_API_KEY missing",
        !hasBrazeUrl && "BRAZE_REST_ENDPOINT/BRAZE_REST_URL missing",
      ]
        .filter(Boolean)
        .join(", ")}) — sends will be skipped`
    );
  }

  for (const msg of errors) {
    console.error(`[startup] ❌ MISSING ENV: ${msg}`);
  }
  for (const msg of warnings) {
    console.warn(`[startup] ⚠️  ${msg}`);
  }

  if (errors.length > 0) {
    console.error(
      `[startup] ${errors.length} required env var(s) missing. Server will start but key features will be broken.`
    );
  }
}
