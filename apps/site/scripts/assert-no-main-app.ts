// Postbuild guard: fail if the main app's auth middleware leaked into the site build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const FORBIDDEN = ["workos", "@workos-inc"];
const serverDir = path.resolve(import.meta.dir, "../.next/server");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (!full.endsWith(".map")) yield full;
  }
}

const offenders: string[] = [];
for (const file of walk(serverDir)) {
  const text = readFileSync(file, "utf8").toLowerCase();
  if (FORBIDDEN.some((needle) => text.includes(needle))) offenders.push(path.relative(serverDir, file));
}

if (offenders.length > 0) {
  console.error(`Main-app code leaked into the site build (WorkOS found in):\n  ${offenders.join("\n  ")}`);
  process.exit(1);
}
console.log("postbuild: no main-app auth code in .next/server");
