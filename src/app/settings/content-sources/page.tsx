import { Header } from "@/components/layout/header";
import { ContentSourcesForm } from "@/components/settings/content-sources-form";
import { getAuth } from "@/lib/auth";
import { loadContentSourcesPageData } from "@/connectors/content/page-data";

export const dynamic = "force-dynamic";

export default async function ContentSourcesPage() {
  const { isAdmin } = await getAuth();
  if (!isAdmin) {
    return (
      <>
        <Header title="Content sources" description="Admin only" />
        <p className="p-6 text-sm text-muted-foreground">Only admins can manage content sources.</p>
      </>
    );
  }
  const { config, tokens, runs } = await loadContentSourcesPageData();
  return (
    <>
      <Header title="Content sources" description="Sync message copy from a CMS, JSON feed or Braze catalog" />
      <div className="p-4 sm:p-6 max-w-4xl space-y-4 sm:space-y-6">
        <ContentSourcesForm initialConfig={config} tokens={tokens} initialRuns={runs} />
      </div>
    </>
  );
}
