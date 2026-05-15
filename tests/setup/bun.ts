import { afterEach, expect, mock } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

// Ensure the API service auth middleware has a secret in test runs.
// Uses ??= so a real CI value (if set) takes precedence.
process.env.INTERNAL_API_SECRET ??= "test-secret";

// Extend expect with jest-dom matchers
expect.extend(matchers);

// Stub Next.js cache/navigation for routes that import them
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not_found"); },
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

// Polyfill vi for Bun (vi.stubEnv, vi.stubGlobal, vi.unstubAllGlobals, vi.unstubAllEnvs)
const _envStubs = new Map<string, string | undefined>();
const _globalStubs = new Map<string, unknown>();

const vi = {
  hoisted: <T>(fn: () => T): T => fn(),
  fn: <T extends (...args: unknown[]) => unknown>(impl?: T) => mock(impl ?? (() => undefined)),
  stubEnv: (key: string, value: string) => {
    if (!_envStubs.has(key)) _envStubs.set(key, process.env[key]);
    process.env[key] = value;
  },
  stubGlobal: (key: string, value: unknown) => {
    if (!_globalStubs.has(key)) _globalStubs.set(key, (globalThis as Record<string, unknown>)[key]);
    (globalThis as Record<string, unknown>)[key] = value;
  },
  unstubAllEnvs: () => {
    for (const [key, orig] of _envStubs) {
      if (orig === undefined) delete process.env[key];
      else process.env[key] = orig;
    }
    _envStubs.clear();
  },
  unstubAllGlobals: () => {
    for (const [key, orig] of _globalStubs) {
      (globalThis as Record<string, unknown>)[key] = orig;
    }
    _globalStubs.clear();
  },
};

// Make vi available globally for tests
(globalThis as unknown as Record<string, unknown>).vi = vi;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

export { vi };
