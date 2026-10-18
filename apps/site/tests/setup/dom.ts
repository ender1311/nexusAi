// SAFETY (first statement after imports): refuse to run site tests against a non-local database.
// See src/lib/db-safety.ts.
// Test preload only (never bundled): share the root localhost allowlist rather than fork it.
// eslint-disable-next-line no-restricted-imports
import { assertLocalDatabase } from "@/lib/db-safety";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// A thrown preload error only fails the first file — bun keeps running the
// rest — so print the abort and hard-exit the whole test process instead.
if (process.env.DATABASE_URL !== undefined) {
  try {
    assertLocalDatabase(process.env.DATABASE_URL, "site test preload");
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
GlobalRegistrator.register();
