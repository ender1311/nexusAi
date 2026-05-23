import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";

type ActiveVariant = { id: string; name: string };

export async function CurrentWinnerCard({
  agentId,
  activeVariants,
}: {
  agentId: string;
  activeVariants: ActiveVariant[];
}) {
  if (activeVariants.length < 2) return null;

  const stats = await prisma.personaArmStats.groupBy({
    by: ["variantId"],
    where: { agentId },
    _sum: { tries: true },
  });

  const total = stats.reduce((s, r) => s + (r._sum.tries ?? 0), 0);
  if (total < 20) return null;

  const sorted = stats
    .map((r) => ({ variantId: r.variantId, tries: r._sum.tries ?? 0 }))
    .sort((a, b) => b.tries - a.tries);

  const leader = sorted[0];
  const topShare = leader.tries / total;
  if (topShare < 0.5) return null;

  const leaderName =
    activeVariants.find((v) => v.id === leader.variantId)?.name ?? "Unknown variant";

  const state: "converging" | "confident" = topShare >= 0.7 ? "confident" : "converging";

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 flex items-center gap-3",
        state === "confident"
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
          : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20",
      )}
    >
      <div
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          state === "confident" ? "bg-emerald-600" : "bg-green-500",
        )}
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-xs font-medium uppercase tracking-wide",
            state === "confident"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-green-700 dark:text-green-400",
          )}
        >
          {state === "confident" ? "Confident" : "Converging"} — leading message
        </p>
        <p className="text-sm font-semibold text-foreground truncate mt-0.5">{leaderName}</p>
      </div>
      <div className="text-right shrink-0">
        <p
          className={cn(
            "text-sm font-bold",
            state === "confident"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-green-700 dark:text-green-400",
          )}
        >
          {Math.round(topShare * 100)}% of sends
        </p>
        <p className="text-xs text-muted-foreground">{total.toLocaleString()} total tries</p>
      </div>
    </div>
  );
}
