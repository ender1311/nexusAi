"use client";
import { useState } from "react";
import { connectorLabel, senders, sources } from "@site/content/connectors";
import { publicConfig } from "@site/lib/public-config";
import { calendlyEmbedUrl } from "@site/lib/leads/calendly-url";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string } | { kind: "booked"; url: string };

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
      if (!res.ok) { setState({ kind: "error", message: json.error ?? "Something went wrong. Please try again." }); return; }
      setState({ kind: "booked", url: calendlyEmbedUrl(publicConfig.calendlyUrl, { email: lead.email ?? "", company: lead.company ?? "" }) });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  if (state.kind === "booked") {
    return (
      <div className="space-y-3">
        <p className="text-sm">Thanks. Pick a time below and we&apos;ll walk through your stack.</p>
        <iframe title="Book a call" src={state.url} className="h-[700px] w-full rounded-lg border border-[var(--border)]" />
      </div>
    );
  }

  const field = "w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
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
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.kind === "error" && <p role="alert" className="text-sm text-red-400 sm:col-span-2">{state.message}</p>}
      <button type="submit" disabled={state.kind === "sending"}
        className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2">
        {state.kind === "sending" ? "Sending…" : "Become a design partner"}
      </button>
    </form>
  );
}
