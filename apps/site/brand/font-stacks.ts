// The font registry's pure half: each key's CSS stack. The next/font loaders that
// define the --font-* variables live in fonts.ts (imported only by the root layout).

const SYSTEM_SANS = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const FONT_STACKS = {
  /** Tailwind's default sans stack: what the site used before brands existed. */
  system: SYSTEM_SANS,
  "system-mono": SYSTEM_MONO,
  inter: `var(--font-inter), ${SYSTEM_SANS}`,
  figtree: `var(--font-figtree), ${SYSTEM_SANS}`,
  "instrument-serif": "var(--font-instrument-serif), Georgia, serif",
  fraunces: "var(--font-fraunces), Georgia, serif",
  "ibm-plex-mono": `var(--font-ibm-plex-mono), ${SYSTEM_MONO}`,
} as const;

export type FontKey = keyof typeof FONT_STACKS;

export function isFontKey(key: string): key is FontKey {
  return Object.hasOwn(FONT_STACKS, key);
}
