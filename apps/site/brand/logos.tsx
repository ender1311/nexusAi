// Brand marks. They draw in currentColor (and the accent token), so they follow the preset.

export const LOGO_KEYS = ["none", "beacon", "monogram"] as const;
export type LogoKey = (typeof LOGO_KEYS)[number];

export function isLogoKey(key: string): key is LogoKey {
  return (LOGO_KEYS as readonly string[]).includes(key);
}

/** A beacon: a solid center with two broadcast arcs on each side. */
function BeaconMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="4" fill="currentColor" />
      <g fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M9.5 9.5a9.2 9.2 0 0 0 0 13" /><path d="M22.5 9.5a9.2 9.2 0 0 1 0 13" />
        <path d="M5 5a15.5 15.5 0 0 0 0 22" /><path d="M27 5a15.5 15.5 0 0 1 0 22" />
      </g>
    </svg>
  );
}

/** An "N" set in a square: the product initial, for editorial presets. */
function MonogramMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" fill="var(--accent)" />
      <path d="M10 23V9h1.5l9 11.2V9H22v14h-1.5l-9-11.2V23z" fill="var(--on-accent)" />
    </svg>
  );
}

export function BrandLogo({ logo, size = 20 }: { logo: LogoKey; size?: number }) {
  if (logo === "beacon") return <BeaconMark size={size} />;
  if (logo === "monogram") return <MonogramMark size={size} />;
  return null;
}
