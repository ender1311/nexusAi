import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Header title="Messages" description="" />
      <div className="p-4 sm:p-6 max-w-3xl space-y-4 sm:space-y-6">
        <Skeleton className="h-10 w-40" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </>
  );
}
