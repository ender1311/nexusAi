// No-op. With the Turbopack root widened to the repo root, Next would otherwise load the
// main app's ../../src/instrumentation.ts, which validates env vars this site does not use.
export async function register() {}
