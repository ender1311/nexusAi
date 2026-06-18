import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bun package cache — not project code
    ".bun/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
