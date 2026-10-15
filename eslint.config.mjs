import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // apps/site may reach into the main app only through @engine/* (pure engine).
  {
    files: ["apps/site/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/*"], message: "apps/site may import only @engine/* from the main app." },
          { regex: "^(\\.\\./)+src/", message: "Use @engine/* — apps/site may import only the pure engine." },
          { regex: "^@engine/.*\\.\\.", message: "@engine/* must not escape the engine directory." },
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
