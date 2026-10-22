// Components read the brand from tokens only. Raw colors, black/white utilities and
// Tailwind's fixed radii would bypass the preset, so they are banned outside brand/.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { brandCss } from "@site/brand/css";
import { midnight } from "@site/brand/presets/midnight";

const root = path.join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}

// brand/ is the one place raw values may live. lib/metrics/client.ts is a verbatim copy of beacon-frontier's
// metrics client (no markup or styles; its prose says "rounded" about numbers), kept byte-for-byte so it can be
// re-copied.
const VENDORED = new Set([path.join(root, "lib", "metrics", "client.ts")]);
const files = ["components", "app", "lib", "content"].flatMap((dir) => sourceFiles(path.join(root, dir))).filter((f) => !VENDORED.has(f));

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const NAMED = "white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|silver|gold|teal|maroon|olive|lime|aqua|fuchsia|cyan|magenta";

const RULES: [string, RegExp][] = [
  ["hex color", /#[0-9a-f]{3,8}\b/i],
  ["black/white utility", /\b(text|bg|border|from|to|via)-(white|black)\b/],
  ["fixed Tailwind radius", /\brounded(-[trblxyse]{1,2})?-(none|xs|sm|md|lg|xl|2xl|3xl|full)\b/],
  ["bare rounded", /\brounded(?=["'\s`}])/],
  ["Tailwind palette color", new RegExp(`\\b(text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|placeholder)-(${PALETTE})-\\d{2,3}\\b`)],
  ["functional color", /\b(rgba?|hsla?|oklch)\(/i],
  ["named color in fill/stroke", new RegExp(`\\b(fill|stroke)=\\{?["'](${NAMED})["']`, "i")],
  ["named color in a style object", new RegExp(`\\b(color|background|backgroundColor|borderColor|fill|stroke)\\s*:\\s*["'](${NAMED})["']`, "i")],
  ["legacy CSS variable", /var\(--(panel|border|text|muted|good)\)/],
];

describe("brand token discipline in components/, app/, lib/ and content/", () => {
  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.includes(`${path.sep}lib${path.sep}`))).toBe(true);
    expect(files.some((f) => f.startsWith(path.join(root, "brand") + path.sep))).toBe(false);
  });

  it("the rules catch what they should", () => {
    const rule = (name: string) => RULES.find(([n]) => n === name)![1];
    expect(rule("Tailwind palette color").test(`className="text-slate-500"`)).toBe(true);
    expect(rule("functional color").test("color: rgba(0, 0, 0, 0.5)")).toBe(true);
    expect(rule("named color in fill/stroke").test(`<path fill="white" />`)).toBe(true);
    expect(rule("named color in fill/stroke").test(`<path fill="currentColor" />`)).toBe(false);
    expect(rule("named color in a style object").test(`style={{ color: "red" }}`)).toBe(true);
    expect(rule("bare rounded").test("`rounded}`")).toBe(true);
    expect(rule("bare rounded").test(`"rounded-chip"`)).toBe(false);
  });

  for (const [name, re] of RULES) {
    it(`has no ${name}`, () => {
      const offenders = files.flatMap((f) =>
        readFileSync(f, "utf8").split("\n").flatMap((line, i) => (re.test(line) ? [`${path.relative(root, f)}:${i + 1}: ${line.trim()}`] : [])));
      expect(offenders).toEqual([]);
    });
  }
});

describe("globals.css and brandCss agree", () => {
  // Regression: globals.css once read var(--ink3) while brandCss emits --ink-3,
  // so every muted text silently fell back to the body color.
  it("every custom property globals.css reads is one brandCss emits", () => {
    const globals = readFileSync(path.join(root, "app", "globals.css"), "utf8");
    const emitted = new Set([...brandCss(midnight, ":x").matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
    const read = [...globals.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(read.length).toBeGreaterThan(20);
    expect(read.filter((v) => !emitted.has(v))).toEqual([]);
  });
});
