import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // apps/site may reach into the main app only through @engine/* and @content-core/* (pure modules).
  {
    files: ["apps/site/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/*"], message: "apps/site may import only @engine/* and @content-core/* from the main app." },
          { regex: "^(\\.\\./)+src/", message: "Use @engine/* or @content-core/* — apps/site may import only those pure modules." },
          { regex: "^@(engine|content-core)/.*\\.\\.", message: "@engine/* and @content-core/* must not escape their directories." },
        ],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Git worktrees (duplicate checkouts) — not primary source
    ".worktrees/**",
    // Installed agent skills (third-party tooling) — not project code
    ".agents/**",
    // HyperFrames video authoring workspace — standalone compositions, own conventions
    "videos/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "apps/site/.next/**",
    "apps/site/test-results/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bun package cache — not project code
    ".bun/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
