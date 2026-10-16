// Writes the next/font loader modules for the active brand (NEXT_PUBLIC_BRAND).
// Runs before dev, build and test. On production (VERCEL_ENV=production) an unknown
// brand throws here, failing the build.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateFontModules } from "../brand/font-codegen";
import { activeBrand } from "../brand/presets";

const brand = activeBrand();
const modules = generateFontModules(brand);
const dir = path.resolve(import.meta.dir, "../brand");

for (const [file, source] of [["active-fonts.generated.ts", modules.active], ["preview-fonts.generated.ts", modules.preview]] as const) {
  const target = path.join(dir, file);
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch { /* first run */ }
  if (current !== source) writeFileSync(target, source);
}
console.log(`fonts: generated loaders for brand "${brand.id}"`);
