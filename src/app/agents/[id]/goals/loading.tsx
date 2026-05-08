import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Header title="Goals Configuration" description="" />
      <div className="p-4 sm:p-6 max-w-2xl space-y-4 sm:space-y-6">
        {/* Add goal form card */}
        <Skeleton className="h-52 rounded-xl" />

        {/* Goals list card */}
        <Skeleton className="h-40 rounded-xl" />

        {/* Action buttons */}
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    </>
  );
}
