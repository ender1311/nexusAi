// The brand Beacon Frontier's studio card reads from this zone: /nexus/brand/icon.svg and brand.json beside it
// (the shape is beacon-frontier's src/catalog/brands.ts). The mark is the Nexus app's network glyph, white on the
// active preset's accent. The app's own favicon changes color by weekday; this one stays fixed so the card is stable.

import { createHash } from "node:crypto";
import { tokenSets, type BrandPreset, type TokenSet } from "./types";

/** `hex` moved toward `toward` by `amount` (0..1). */
function mix(hex: string, toward: string, amount: number): string {
  const channel = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(hex, i) + (channel(toward, i) - channel(hex, i)) * amount));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The card's colors: the light set, or the only set a single-scheme preset has. */
function primaryTokens(preset: BrandPreset): TokenSet {
  return tokenSets(preset)[0].tokens;
}

/** The 512px master icon. Glyph paths match src/components/layout/nexus-mark.tsx (lucide Network). */
export function studioIcon(preset: BrandPreset): string {
  const { accent } = primaryTokens(preset);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(accent, "#ffffff", 0.22)}"/><stop offset="1" stop-color="${mix(accent, "#000000", 0.18)}"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><g transform="translate(112 112) scale(12)" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></g></svg>
`;
}

export function studioBrand(preset: BrandPreset) {
  const main = primaryTokens(preset);
  const dark = preset.colorScheme === "auto" ? preset.dark : null;
  return {
    version: 1,
    id: "nexus",
    name: preset.identity.product,
    icon: "icon.svg",
    iconSha256: createHash("sha256").update(studioIcon(preset)).digest("hex"),
    colors: {
      accent: main.accent,
      onAccent: main.onAccent,
      background: main.bg,
      text: main.ink,
      ...(dark && { dark: { accent: dark.accent, onAccent: dark.onAccent, background: dark.bg, text: dark.ink } }),
    },
    source: `github.com/ender1311/nexusAi: apps/site/brand/presets/${preset.id}.ts (apps/site/brand/studio.ts)`,
  } as const;
}
