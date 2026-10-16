import type { BrandPreset } from "../types";

/**
 * Nexus Midnight: the site's original look, token for token. Dark ink-blue in a
 * dark OS, cool off-white in a light one; system fonts; 6/8/16px radii.
 * The default when NEXT_PUBLIC_BRAND is unset.
 */
export const midnight = {
  id: "midnight",
  label: "Nexus Midnight",
  identity: {
    name: "Beacon Frontier",
    product: "Nexus",
    eyebrow: "Nexus by Beacon Frontier",
    logo: "none",
    ogTitle: "Nexus: AI decisioning for the stack you already have",
  },
  colorScheme: "auto",
  light: {
    bg: "#f7f8fb",
    surface: "#ffffff",
    surface2: "#eef0f5",
    ink: "#121521",
    ink2: "#2e3445",
    ink3: "#5b6478",
    line: "#e3e6ee",
    accent: "#3a5cff",
    // #3a5cff is 4.76:1 on the light ground, so it doubles as small accent text.
    accentInk: "#3a5cff",
    // White on #3a5cff is 5.05:1.
    onAccent: "#ffffff",
    ok: "#0f9f62",
    okBg: "#e3f5ec",
    bad: "#dc2626",
    badBg: "#fde8e8",
    focus: "#3a5cff",
    mark: "#d6defe",
    chart: ["#7c9cff", "#3ecf8e", "#f5a524", "#f25f8a"],
  },
  dark: {
    bg: "#0b0d12",
    surface: "#12151d",
    surface2: "#181c27",
    ink: "#e8ebf2",
    ink2: "#c3c8d4",
    ink3: "#8a93a8",
    line: "#232838",
    accent: "#7c9cff",
    accentInk: "#7c9cff",
    // White on #7c9cff is only 2.61:1; the dark ground color is 7.46:1.
    onAccent: "#0b0d12",
    ok: "#3ecf8e",
    okBg: "#0f2a1f",
    bad: "#f87171",
    badBg: "#2a1414",
    focus: "#7c9cff",
    mark: "#2b3a70",
    chart: ["#7c9cff", "#3ecf8e", "#f5a524", "#f25f8a"],
  },
  fonts: { display: "system", body: "system", mono: "system-mono", displayWeight: "700", displayTracking: "0em" },
  shape: { radiusSm: "6px", radius: "8px", radiusLg: "16px", radiusChip: "9999px", shadow: "none", shadowPop: "none", borderWidth: "1px" },
  text: { labelCase: "uppercase", labelTracking: "0.05em", eyebrowCase: "none", eyebrowTracking: "0em", btnCase: "none", btnWeight: "600" },
  density: "comfortable",
  layout: { sections: ["hero", "stack", "simulator", "how", "comparison", "offer", "faq"], hero: "left" },
} satisfies BrandPreset;
