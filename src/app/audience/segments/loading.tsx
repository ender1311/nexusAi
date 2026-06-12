import { Skeleton } from "@/components/ui/skeleton";

export default function SegmentsLoading() {
  return (
    <div className="flex-1 p-6 space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
