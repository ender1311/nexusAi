// The font registry: each key's CSS stack, and for web fonts the next/font loader
// that defines its --font-* variable. scripts/gen-active-fonts.ts turns WEB_FONTS
// into the generated loader modules (next/font needs literal calls at module scope).

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

export type WebFont = {
  /** The export name in next/font/google. */
  loader: string;
  /** The CSS variable the stack above reads. */
  variable: `--font-${string}`;
  /** Extra loader options, as TypeScript source. */
  options: string;
};

/** Self-hosted Google fonts (the CSP is font-src 'self'). Keys without an entry are system stacks. */
export const WEB_FONTS: Partial<Record<FontKey, WebFont>> = {
  inter: { loader: "Inter", variable: "--font-inter", options: "" },
  figtree: { loader: "Figtree", variable: "--font-figtree", options: "" },
  "instrument-serif": { loader: "Instrument_Serif", variable: "--font-instrument-serif", options: 'weight: "400", style: ["normal", "italic"], ' },
  fraunces: { loader: "Fraunces", variable: "--font-fraunces", options: "" },
  "ibm-plex-mono": { loader: "IBM_Plex_Mono", variable: "--font-ibm-plex-mono", options: 'weight: ["400", "500"], ' },
};

export function isFontKey(key: string): key is FontKey {
  return Object.hasOwn(FONT_STACKS, key);
}
