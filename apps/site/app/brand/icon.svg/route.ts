import { activeBrand } from "@site/brand/presets";
import { studioIcon } from "@site/brand/studio";

// Read by Beacon Frontier's studio card (see brand/studio.ts). Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return new Response(studioIcon(activeBrand()), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
  });
}
