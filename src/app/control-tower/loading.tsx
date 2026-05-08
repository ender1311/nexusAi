import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Control Tower" description="AI-Powered Optimization Command Center" />

      {/* Stats bar */}
      <div className="border-b bg-muted/30 px-4 sm:px-6 py-2 sm:py-2.5 flex items-center gap-4 shrink-0">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Agent toggles + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        </div>

        {/* User inspector + cron runs */}
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}
