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

const files = [...sourceFiles(path.join(root, "components")), ...sourceFiles(path.join(root, "app"))];

const RULES: [string, RegExp][] = [
  ["hex color", /#[0-9a-f]{3,8}\b/i],
  ["black/white utility", /\b(text|bg|border|from|to|via)-(white|black)\b/],
  ["fixed Tailwind radius", /\brounded(-[trblxyse]{1,2})?-(none|xs|sm|md|lg|xl|2xl|3xl|full)\b/],
  ["bare rounded", /\brounded(?=["\s`])/],
  ["legacy CSS variable", /var\(--(panel|border|text|muted|good)\)/],
];

describe("brand token discipline in components/ and app/", () => {
  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(15);
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
