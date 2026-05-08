import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Header title="Create Agent" description="Configure a new Nexus agent" />
      <div className="p-4 sm:p-6">
        {/* Wizard step indicators */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        {/* Wizard card */}
        <Skeleton className="h-96 rounded-xl" />
        {/* Nav buttons */}
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </>
  );
}
