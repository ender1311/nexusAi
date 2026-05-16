export const revalidate = 900;

import { Header } from "@/components/layout/header";
import { AgentWizardClient } from "./agent-wizard-client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import type { Persona } from "@/types/persona";

const getPersonasForWizard = unstable_cache(
  () => prisma.persona.findMany({ orderBy: { name: "asc" } }),
  ["personas-wizard"],
  { tags: ["personas"], revalidate: 900 }
);

export default async function NewAgentPage() {
  const personas = (await getPersonasForWizard()) as unknown as Persona[];
  return (
    <>
      <Header title="Create Agent" description="Configure a new Nexus agent" />
      <div className="p-4 sm:p-6">
        <AgentWizardClient personas={personas} />
      </div>
    </>
  );
}
