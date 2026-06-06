// Regression: agent launches 504'd on Vercel. The Neon adapter sends plain queries
// over HTTP but opens a WebSocket for interactive transactions — and a nested
// prisma.agent.create() IS an interactive transaction. With no explicit
// neonConfig.webSocketConstructor, the driver fell back to Vercel Node's global
// WebSocket, which constructs but cannot carry Neon's wire protocol, so every write
// transaction hung until the function timed out. Reads (HTTP) were unaffected, which
// is why the bug only showed up on create/update. Fix: pin the `ws` package as the
// constructor. Bun's compliant global WebSocket masked this locally.
//
// This guards the fix statically (importing db.ts would require DATABASE_URL and
// instantiate Prisma): the constructor assignment must stay, and `ws` must remain a
// declared dependency — dropping it would reintroduce the workspace-hoist landmine
// on isolated cold-start deploys.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const apiRoot = join(import.meta.dir, "..", "..", "apps", "api");

describe("apps/api Neon WebSocket constructor", () => {
  it("db.ts pins the ws package as neonConfig.webSocketConstructor", () => {
    const src = readFileSync(join(apiRoot, "src", "lib", "db.ts"), "utf8");
    expect(src).toContain('from "ws"');
    expect(src).toMatch(/neonConfig\.webSocketConstructor\s*=\s*WebSocket/);
  });

  it("declares ws as a dependency (guards the workspace-hoist cold-start landmine)", () => {
    const pkg = JSON.parse(readFileSync(join(apiRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.ws).toBeDefined();
  });
});
