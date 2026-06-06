import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: number;
  className?: string;
  /** When set, the whole card becomes a link to this route. */
  href?: string;
}

export function MetricCard({ title, value, description, icon: Icon, trend, className, href }: MetricCardProps) {
  const card = (
    <Card
      className={cn(
        href && "h-full transition-colors hover:border-primary/40 hover:bg-muted/40",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {(description || trend !== undefined) && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            {trend !== undefined && (
              <span className={cn(trend > 0 ? "text-green-600" : trend < 0 ? "text-red-500" : "text-muted-foreground")}>
                {trend === 0 ? "—" : `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`}
              </span>
            )}
            {description}
          </p>
        )}
      </CardContent>
    </Card>
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
