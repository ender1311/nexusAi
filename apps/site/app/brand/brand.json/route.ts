import { NextResponse } from "next/server";
import { activeBrand } from "@site/brand/presets";
import { studioBrand } from "@site/brand/studio";

// Read by Beacon Frontier's studio card (see brand/studio.ts). Built once per deploy.
export const dynamic = "force-static";

export function GET(): NextResponse<ReturnType<typeof studioBrand>> {
  return NextResponse.json(studioBrand(activeBrand()), { headers: { "Cache-Control": "public, max-age=3600" } });
}
