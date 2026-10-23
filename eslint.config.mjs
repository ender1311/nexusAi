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
  // eslint-config-next 16.4 ships eslint-plugin-react-hooks 7.1, whose set-state-in-effect
  // check flags 18 existing call sites that 7.0 passed. Warn (not error) so the Next.js
  // security bump does not carry a behavior refactor; fix the call sites, then remove this.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
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
