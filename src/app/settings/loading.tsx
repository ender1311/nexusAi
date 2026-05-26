import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Header title="Settings" description="Platform configuration" />
      <div className="p-4 sm:p-6 max-w-3xl space-y-4 sm:space-y-6">
        {/* Default Send Limits card */}
        <Skeleton className="h-36 rounded-xl" />

        {/* Persona Discovery card */}
        <Skeleton className="h-52 rounded-xl" />

        {/* Save button row */}
        <Skeleton className="h-9 w-32" />
      </div>
    </>
  );
}
