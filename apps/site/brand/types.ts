import type { FontKey } from "./font-stacks";
import type { LogoKey } from "./logos";

/** A 6-digit hex color, e.g. "#1e2a44". The validator checks the format. */
export type Hex = string;

/** One color scheme's semantic tokens. Every text pair is contrast-tested (see tests/brand-contrast.test.ts). */
export type TokenSet = {
  /** Page background. */
  bg: Hex;
  /** Cards, panels, code blocks. */
  surface: Hex;
  /** A second, quieter fill (bars, hovered rows). */
  surface2: Hex;
  /** Body text. ≥ 4.5:1 on bg and surface. */
  ink: Hex;
  /** Secondary text. */
  ink2: Hex;
  /** Muted text (captions, labels). ≥ 4.5:1 on bg. */
  ink3: Hex;
  /** Borders and rules. */
  line: Hex;
  /** Buttons, active pills, chart highlight, decorative accents. */
  accent: Hex;
  /** Small accent text (eyebrow, links). ≥ 4.5:1 on bg. */
  accentInk: Hex;
  /** Text on accent fills. ≥ 4.5:1 on accent. */
  onAccent: Hex;
  ok: Hex;
  okBg: Hex;
  bad: Hex;
  badBg: Hex;
  /** Focus ring. */
  focus: Hex;
  /** Text selection background. */
  mark: Hex;
  /** Chart series, in order. */
  chart: [Hex, Hex, Hex, Hex];
};

export const TOKEN_NAMES = [
  "bg", "surface", "surface2", "ink", "ink2", "ink3", "line", "accent", "accentInk", "onAccent",
  "ok", "okBg", "bad", "badBg", "focus", "mark",
] as const satisfies readonly Exclude<keyof TokenSet, "chart">[];

export const SECTION_IDS = ["hero", "stack", "simulator", "how", "comparison", "offer", "faq"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type Density = "compact" | "comfortable" | "airy";
export type TextCase = "none" | "uppercase";

type BrandBase = {
  /** Registry key, also the `data-brand` attribute value and the NEXT_PUBLIC_BRAND value. */
  id: string;
  /** Human name of the preset, shown on /nexus/brand. */
  label: string;
  identity: {
    /** The studio, e.g. "Beacon Frontier" (footer, copyright). */
    name: string;
    /** The product, e.g. "Nexus". */
    product: string;
    /** The line above the hero heading. */
    eyebrow: string;
    logo: LogoKey;
    /** The landing page <title> and Open Graph title. */
    ogTitle: string;
    /** The landing page meta and Open Graph description. */
    ogDescription: string;
  };
  fonts: {
    display: FontKey;
    body: FontKey;
    /** Code blocks and the decision log. */
    mono: FontKey;
    /** CSS font-weight for display headings, e.g. "700". */
    displayWeight: string;
    /** CSS letter-spacing for display headings, e.g. "-0.01em". The hero is 0.025em tighter. */
    displayTracking: string;
  };
  shape: {
    /** Buttons, fields, small controls. */
    radiusSm: string;
    /** Boxes: code blocks, stats, nodes. */
    radius: string;
    /** Panels and cards. */
    radiusLg: string;
    /** Pills and chips. */
    radiusChip: string;
    shadow: string;
    shadowPop: string;
    borderWidth: string;
  };
  text: {
    labelCase: TextCase;
    labelTracking: string;
    eyebrowCase: TextCase;
    eyebrowTracking: string;
    btnCase: TextCase;
    btnWeight: string;
  };
  density: Density;
  layout: {
    /** Landing page sections, in render order. "offer" is required. */
    sections: SectionId[];
    hero: "left" | "centered";
  };
};

export type BrandPreset =
  | (BrandBase & { colorScheme: "light"; light: TokenSet })
  | (BrandBase & { colorScheme: "dark"; dark: TokenSet })
  | (BrandBase & { colorScheme: "auto"; light: TokenSet; dark: TokenSet });

/** Every token set a preset defines, labelled by scheme. */
export function tokenSets(preset: BrandPreset): { scheme: "light" | "dark"; tokens: TokenSet }[] {
  if (preset.colorScheme === "light") return [{ scheme: "light", tokens: preset.light }];
  if (preset.colorScheme === "dark") return [{ scheme: "dark", tokens: preset.dark }];
  return [{ scheme: "light", tokens: preset.light }, { scheme: "dark", tokens: preset.dark }];
}

