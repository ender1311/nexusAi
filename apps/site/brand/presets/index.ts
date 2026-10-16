import type { BrandPreset } from "../types";
import { editorial } from "./editorial";
import { humanHand } from "./human-hand";
import { midnight } from "./midnight";

export type BrandId = "midnight" | "human-hand" | "editorial";

/** Every preset, by id. Add a preset here (and to BrandId) to make it selectable. */
export const BRANDS: Record<BrandId, BrandPreset> = {
  midnight,
  "human-hand": humanHand,
  editorial,
};

export const DEFAULT_BRAND: BrandId = "midnight";

const warned = new Set<string>();

function isBrandId(id: string): id is BrandId {
  return Object.hasOwn(BRANDS, id);
}

/**
 * The preset for a NEXT_PUBLIC_BRAND value. Unset → midnight; unknown → midnight plus a
 * warning, or an error when `strict` (production builds), so a typo can't ship the wrong look.
 */
export function resolveBrand(value: string | undefined, { strict = false }: { strict?: boolean } = {}): BrandPreset {
  const id = value?.trim() ?? "";
  if (id === "") return BRANDS[DEFAULT_BRAND];
  if (isBrandId(id)) return BRANDS[id];
  if (strict) throw new Error(`NEXT_PUBLIC_BRAND="${id}" is not a known brand (${Object.keys(BRANDS).join(", ")}).`);
  if (!warned.has(id)) {
    warned.add(id);
    console.warn(`NEXT_PUBLIC_BRAND="${id}" is not a known brand (${Object.keys(BRANDS).join(", ")}); using ${DEFAULT_BRAND}.`);
  }
  return BRANDS[DEFAULT_BRAND];
}

/** The brand this deployment renders, from NEXT_PUBLIC_BRAND. Strict on production (VERCEL_ENV=production). */
export function activeBrand(): BrandPreset {
  return resolveBrand(process.env.NEXT_PUBLIC_BRAND, { strict: process.env.VERCEL_ENV === "production" });
}

type PresetOverrides = Partial<Pick<BrandPreset, "label" | "identity" | "fonts" | "shape" | "text" | "density" | "layout">>;

/** A preset with some top-level fields replaced. For tests and previews. */
export function withPreset(id: BrandId, overrides: PresetOverrides): BrandPreset {
  return { ...BRANDS[id], ...overrides };
}
