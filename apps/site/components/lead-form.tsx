"use client";
import { useState } from "react";
import { connectorLabel, senders, sources } from "@site/content/connectors";
import { publicConfig } from "@site/lib/public-config";
import { calendlyEmbedUrl } from "@site/lib/leads/calendly-url";
import { ui } from "@site/components/ui";
import { trackLeadError, trackLeadStart, trackLeadSubmit } from "@site/lib/metrics";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string; offerDirectBooking: boolean } | { kind: "booked"; url: string };

export function LeadForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const form = new FormData(e.currentTarget);
    const lead = Object.fromEntries(form.entries()) as Record<string, string>;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/nexus/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        trackLeadError(res.status);
        setState({ kind: "error", message: json.error ?? "Something went wrong. Please try again.", offerDirectBooking: res.status >= 500 });
        return;
      }
      trackLeadSubmit();
      setState({ kind: "booked", url: calendlyEmbedUrl(publicConfig.calendlyUrl, { email: lead.email ?? "", company: lead.company ?? "" }) });
    } catch {
      trackLeadError(null);
      setState({ kind: "error", message: "Network error. Please try again.", offerDirectBooking: true });
    }
  }

  if (state.kind === "booked") {
    return (
      <div className="space-y-3">
        <p className="text-sm">Thanks. Pick a time below and we&apos;ll walk through your stack.</p>
        <iframe title="Book a call" src={state.url} className={`h-[700px] w-full ${ui.box}`} />
      </div>
    );
  }

  const field = ui.field;
  return (
    <form onSubmit={onSubmit} onFocus={trackLeadStart} className="relative grid gap-3 sm:grid-cols-2" noValidate>
      <label className="flex flex-col gap-1 text-sm">Work email<input name="email" type="email" required className={field} autoComplete="email" /></label>
      <label className="flex flex-col gap-1 text-sm">Company<input name="company" required className={field} autoComplete="organization" /></label>
      <label className="flex flex-col gap-1 text-sm">Data source
        <select name="source" className={field} defaultValue="segment">
          {sources().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}<option value="other">Other</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Sender
        <select name="sender" className={field} defaultValue="braze">
          {senders().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}<option value="other">Other</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">Use case to pilot
        <textarea name="useCase" required maxLength={280} rows={3} className={field} placeholder="e.g. win back users who lapsed after their trial" />
      </label>
      {/* Honeypot: off-screen for people, tempting for bots. */}
      <div inert className="absolute -left-[9999px]">
        <label>Website<input name="nx_hp" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-bad sm:col-span-2">
          {state.message}
          {state.offerDirectBooking && (
            <> <a href={publicConfig.calendlyUrl} data-cta="book-call-direct" data-kind="calendly" target="_blank" rel="noopener noreferrer" className="underline">Or book a call directly →</a></>
          )}
        </p>
      )}
      <button type="submit" data-cta="design-partner-submit" disabled={state.kind === "sending"}
        className={`rounded-brand-sm bg-accent px-[var(--control-x)] py-[calc(var(--control-y)*1.25)] text-sm text-on-accent ${ui.btnText} disabled:opacity-60 sm:col-span-2`}>
        {state.kind === "sending" ? "Sending…" : "Become a design partner"}
      </button>
      <p className="text-xs text-ink-3 sm:col-span-2">
        We use your details only to follow up about the pilot. For spam protection we store a hashed IP, never the raw address.
      </p>
    </form>
  );
}
