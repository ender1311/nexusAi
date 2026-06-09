import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

type SearchHit = {
  externalId: string;
  brazeId: string | null;
  email: string | null;
  name: string | null;
  funnelStage: string | null;
  personaName: string | null;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function emailOf(attrs: Record<string, unknown>): string | null {
  return typeof attrs.email === "string" ? attrs.email : null;
}

function nameOf(attrs: Record<string, unknown>): string | null {
  if (typeof attrs.name === "string" && attrs.name) return attrs.name;
  const parts = [attrs.first_name, attrs.last_name].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length ? parts.join(" ") : null;
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return fail("Query parameter 'q' is required", 400);

  try {
    if (q.includes("@")) {
      // Email exact match via the expression index (User_attributes_email_idx).
      // Prisma's JSON-path filter does NOT reliably use it — see the regression test.
      // Select first/last name too so the name falls back the same way nameOf does
      // (the id/brazeId path below uses nameOf); otherwise this path returned a null
      // name for users that only have first_name/last_name attributes.
      const rows = await prisma.$queryRaw<Array<{
        externalId: string; brazeId: string | null; email: string | null;
        name: string | null; firstName: string | null; lastName: string | null;
        funnelStage: string | null; personaName: string | null;
      }>>`
        SELECT u."externalId", u."brazeId",
               u."attributes"->>'email'      AS email,
               u."attributes"->>'name'       AS name,
               u."attributes"->>'first_name' AS "firstName",
               u."attributes"->>'last_name'  AS "lastName",
               u."funnelStage",
               p."name" AS "personaName"
        FROM "User" u
        LEFT JOIN "Persona" p ON p."id" = u."personaId"
        WHERE u."attributes"->>'email' = ${q}
        LIMIT 25
      `;
      return ok<SearchHit[]>(
        rows.map((r) => ({
          externalId: r.externalId,
          brazeId: r.brazeId,
          email: r.email,
          name: r.name || [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
          funnelStage: r.funnelStage,
          personaName: r.personaName,
        })),
      );
    }

    // Exact identifier lookup: externalId first, then brazeId (both @unique).
    const user =
      (await prisma.trackedUser.findUnique({ where: { externalId: q }, include: { persona: true } })) ??
      (await prisma.trackedUser.findUnique({ where: { brazeId: q }, include: { persona: true } }));

    if (!user) return ok<SearchHit[]>([]);

    const attrs = asRecord(user.attributes);
    const hit: SearchHit = {
      externalId: user.externalId,
      brazeId: user.brazeId,
      email: emailOf(attrs),
      name: nameOf(attrs),
      funnelStage: user.funnelStage,
      personaName: user.persona?.name ?? null,
    };
    return ok<SearchHit[]>([hit]);
  } catch (err) {
    return handleRouteError("GET /api/users/search", err);
  }
}
