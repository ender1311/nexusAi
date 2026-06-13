import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ContentCardLibraryLoading() {
  return (
    <>
      <Header title="Content Card Library" />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-[72px] rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-6 w-16 rounded-full" />
              ))}
            </div>
          </div>
        </div>
        {[1, 2].map((g) => (
          <div key={g} className="space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-7 rounded-full" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-52 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
