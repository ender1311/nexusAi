import Link from "next/link";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

// Discrete accent colour slots — kept as full Tailwind classes so the compiler
// never purges them (no runtime string interpolation).
const ACCENT: Record<string, { icon: string; bg: string; desc: string }> = {
  violet:  { icon: "text-violet-500",  bg: "bg-violet-500/10",  desc: "text-violet-500" },
  cyan:    { icon: "text-cyan-500",    bg: "bg-cyan-500/10",    desc: "text-cyan-500" },
  pink:    { icon: "text-pink-500",    bg: "bg-pink-500/10",    desc: "text-pink-500" },
  emerald: { icon: "text-emerald-500", bg: "bg-emerald-500/10", desc: "text-emerald-500" },
  indigo:  { icon: "text-indigo-400",  bg: "bg-indigo-500/10",  desc: "text-indigo-400" },
  amber:   { icon: "text-amber-500",   bg: "bg-amber-500/10",   desc: "text-amber-500" },
  green:   { icon: "text-green-500",   bg: "bg-green-500/10",   desc: "text-green-500" },
  orange:  { icon: "text-orange-500",  bg: "bg-orange-500/10",  desc: "text-orange-500" },
  default: { icon: "text-muted-foreground", bg: "bg-muted",     desc: "text-muted-foreground" },
};

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: number;
  className?: string;
  /** When set, the whole card becomes a link to this route. */
  href?: string;
  /** Accent colour slot — controls icon colour and background circle. */
  accentColor?: keyof typeof ACCENT;
}

export function MetricCard({ title, value, description, icon: Icon, trend, className, href, accentColor = "default" }: MetricCardProps) {
  const { icon: iconCls, bg: bgCls, desc: descCls } = ACCENT[accentColor] ?? ACCENT.default;

  const card = (
    <div
      className={cn(
        "rounded-2xl border bg-card px-5 pt-5 pb-4 flex flex-col gap-3 min-h-[148px] h-full",
        href && "transition-colors hover:border-primary/40 hover:bg-muted/40 cursor-pointer",
        className,
      )}
    >
      {Icon && (
        <div className={cn("inline-flex w-fit items-center justify-center rounded-xl p-2.5", bgCls)}>
          <Icon className={cn("h-5 w-5", iconCls)} />
        </div>
      )}
      <div>
        <div className="text-3xl font-extrabold tracking-tight leading-none">{value}</div>
        <p className="text-xs font-medium text-muted-foreground mt-1.5">{title}</p>
        {description && (
          <p className={cn("text-xs font-medium mt-1 flex items-center gap-1", descCls)}>
            {trend !== undefined && trend !== 0 && (
              <span className={trend > 0 ? "text-emerald-500" : "text-red-500"}>
                {`${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`}
              </span>
            )}
            {description}
          </p>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {card}
      </Link>
    );
  }
  return card;
}
