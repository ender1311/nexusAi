"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const EVENT_OPTIONS = [
  "push_open",
  "app_open",
  "plan_started",
  "donation_completed",
  "plan_completed",
];

function toLocalDatetimeValue(date: Date): string {
  // Format: YYYY-MM-DDTHH:MM (required by datetime-local inputs)
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

type ResultState =
  | { kind: "idle" }
  | { kind: "success"; processed: number; matched: number }
  | { kind: "error"; message: string };

export function EventPushForm() {
  const [userId, setUserId] = useState("");
  const [eventName, setEventName] = useState("push_open");
  const [occurredAt, setOccurredAt] = useState(toLocalDatetimeValue(new Date()));
  const [propertiesRaw, setPropertiesRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult({ kind: "idle" });

    if (!userId.trim()) {
      setResult({ kind: "error", message: "User ID is required." });
      return;
    }
    if (!eventName.trim()) {
      setResult({ kind: "error", message: "Event name is required." });
      return;
    }

    const occurredAtDate = new Date(occurredAt);
    if (isNaN(occurredAtDate.getTime())) {
      setResult({ kind: "error", message: "Occurred At is not a valid date." });
      return;
    }
    const occurredAtISO = occurredAtDate.toISOString();

    let properties: Record<string, unknown> = {};
    if (propertiesRaw.trim()) {
      try {
        properties = JSON.parse(propertiesRaw) as Record<string, unknown>;
      } catch {
        setResult({ kind: "error", message: "Properties must be valid JSON." });
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/data-ingest/push-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_user_id: userId.trim(),
          event_name: eventName.trim(),
          occurred_at: occurredAtISO,
          properties,
        }),
      });

      const json = (await res.json()) as
        | { data: { processed?: number; matched?: number } }
        | { error: string };

      if (!res.ok) {
        const message = "error" in json ? json.error : "Unknown error";
        setResult({ kind: "error", message });
        return;
      }

      const data = "data" in json ? json.data : {};
      setResult({
        kind: "success",
        processed: data.processed ?? 0,
        matched: data.matched ?? 0,
      });
    } catch {
      setResult({ kind: "error", message: "Network error — request failed." });
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Push Test Event</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pe-user-id">
              User ID
            </label>
            <input
              id="pe-user-id"
              type="text"
              className={inputClass}
              placeholder="external_user_id or braze_id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pe-event-name">
              Event Name
            </label>
            <select
              id="pe-event-name"
              className={inputClass}
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              disabled={loading}
            >
              {EVENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
            {eventName === "__custom__" && (
              <input
                type="text"
                className={inputClass}
                placeholder="e.g. plan_read_day_3"
                onChange={(e) => setEventName(e.target.value || "__custom__")}
                disabled={loading}
                autoComplete="off"
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pe-occurred-at">
              Occurred At
            </label>
            <input
              id="pe-occurred-at"
              type="datetime-local"
              className={inputClass}
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pe-properties">
              Properties <span className="text-muted-foreground/60">(optional JSON)</span>
            </label>
            <textarea
              id="pe-properties"
              className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="{}"
              value={propertiesRaw}
              onChange={(e) => setPropertiesRaw(e.target.value)}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? "Pushing…" : "Push Event"}
          </button>
        </form>

        {result.kind === "success" && (
          <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
            Event pushed — processed: {result.processed}, matched: {result.matched}
          </div>
        )}
        {result.kind === "error" && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
            {result.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
