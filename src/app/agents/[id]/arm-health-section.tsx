import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ActiveVariant = { id: string; name: string; warmupUntil: Date | null };

export async function ArmHealthSection({
  agentId,
  activeVariants,
}: {
  agentId: string;
  activeVariants: ActiveVariant[];
}) {
  const armHealthData = await prisma.personaArmStats.findMany({
    where: { agentId },
    orderBy: { id: "desc" },
    take: 500,
  });

  const now = new Date();
  const triesByVariant = new Map<string, number>();
  for (const row of armHealthData) {
    const current = triesByVariant.get(row.variantId) ?? 0;
    if (row.tries > current) triesByVariant.set(row.variantId, row.tries);
  }

  const variantHealth = activeVariants.map((v) => ({
    variantId: v.id,
    variantName: v.name,
    totalTries: triesByVariant.get(v.id) ?? 0,
    hasStats: (triesByVariant.get(v.id) ?? 0) > 0,
    inWarmup: v.warmupUntil !== null && v.warmupUntil > now,
  }));

  const variantsWithStats = variantHealth.filter((v) => v.hasStats).length;
  const variantsInWarmup = variantHealth.filter((v) => v.inWarmup).length;

  let healthStatus: "healthy" | "warning" | "critical";
  if (activeVariants.length === 0 || variantsWithStats === 0) {
    healthStatus = "critical";
  } else if (variantsWithStats / activeVariants.length < 0.5) {
    healthStatus = "warning";
  } else {
    healthStatus = "healthy";
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Variant Health</CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "text-xs capitalize",
              healthStatus === "healthy"
                ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800"
                : healthStatus === "warning"
                  ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800"
                  : "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800",
            )}
          >
            {healthStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: "Active Variants", value: activeVariants.length },
            { label: "With Stats", value: variantsWithStats },
            { label: "In Warmup", value: variantsInWarmup },
            { label: "No Stats", value: activeVariants.length - variantsWithStats },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {variantHealth.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">No active variants.</p>
        ) : (
          <div className="space-y-2">
            {variantHealth.map((v) => (
              <div
                key={v.variantId}
                className="flex items-center justify-between p-2 border rounded-md"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      v.hasStats ? "bg-green-500" : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="text-sm">{v.variantName}</span>
                  {v.inWarmup && (
                    <Badge
                      variant="outline"
                      className="text-xs text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800"
                    >
                      warmup
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {v.totalTries} tries
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
