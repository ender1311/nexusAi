import { Header } from "@/components/layout/header";
import { AgentWizard } from "@/components/agents/agent-wizard";
import { prisma } from "@/lib/db";
import type { Persona } from "@/types/persona";

export default async function NewAgentPage() {
  const personas = (await prisma.persona.findMany({ orderBy: { name: "asc" } })) as unknown as Persona[];
  return (
    <>
      <Header title="Create Agent" description="Configure a new Nexus agent" />
      <div className="p-4 sm:p-6">
        <AgentWizard personas={personas} />
      </div>
    </>
  );
}
