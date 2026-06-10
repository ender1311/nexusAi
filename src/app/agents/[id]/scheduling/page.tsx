import { redirect } from "next/navigation";

export default async function SchedulingRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/agents/${id}?tab=settings`);
}
