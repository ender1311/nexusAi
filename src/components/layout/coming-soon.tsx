import { Header } from "@/components/layout/header";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <Header title={title} description={description} />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-xl border bg-card px-8 py-10 text-center max-w-md">
          <p className="text-sm font-semibold text-muted-foreground">Coming soon</p>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </>
  );
}
