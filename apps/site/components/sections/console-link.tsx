import { COPY } from "@site/content/copy";
import { publicConfig } from "@site/lib/public-config";
import { ui } from "@site/components/ui";

export function ConsoleLink() {
  return (
    <section className={ui.section}>
      <h2 className={`text-2xl ${ui.display}`}>{COPY.console.title}</h2>
      <p className="mt-2 text-ink-3">{COPY.console.body}</p>
      <a href={publicConfig.consoleUrl} target="_blank" rel="noopener noreferrer" className={`mt-4 inline-block rounded-brand-sm ${ui.border} px-4 py-2 ${ui.btnText}`}>{COPY.console.cta} ↗</a>
    </section>
  );
}
