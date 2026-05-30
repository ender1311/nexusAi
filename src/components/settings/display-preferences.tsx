"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, Loader2, Eye } from "lucide-react";
import { STAT_CATALOG, type StatKey } from "@/lib/stat-visibility";

export function DisplayPreferences() {
  const [hidden, setHidden] = useState<Set<StatKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/preferences/stat-visibility")
      .then((r) => r.json())
      .then((body: { data?: { hiddenStats?: StatKey[] } }) => {
        setHidden(new Set(body.data?.hiddenStats ?? []));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: StatKey, visible: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/preferences/stat-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenStats: [...hidden] }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Eye className="h-4 w-4" />
          Display Preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Choose which stats are shown to you. Turning one off hides it from your view only —
          it doesn&apos;t affect other users or the underlying data.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading preferences…
          </div>
        ) : (
          STAT_CATALOG.map((group) => (
            <div key={group.surface} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="space-y-2">
                {group.stats.map((stat) => (
                  <div key={stat.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm">{stat.label}</span>
                    <Switch
                      checked={!hidden.has(stat.key)}
                      onCheckedChange={(v) => toggle(stat.key, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || loading} size="sm">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : "Save Display Preferences"}
          </Button>
          {saved && (
            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              Saved!
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
