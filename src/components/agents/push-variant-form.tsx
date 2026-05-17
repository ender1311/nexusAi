"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeeplinkSelect } from "@/components/agents/deeplink-select";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { FrequencyCap } from "@/types/agent";

export interface PushVariantDraft {
  name: string;
  body: string;
  title: string;
  deeplink: string;
  iconImageUrl: string;
  preferredHour: number | null;
  preferredDayOfWeek: number | null;
  frequencyCapOverride: FrequencyCap | null;
}

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i === 0 ? "12" : i > 12 ? i - 12 : i}:00 ${i < 12 ? "AM" : "PM"}`,
}));

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

interface PushVariantFormProps {
  variant: PushVariantDraft;
  onChange: (v: PushVariantDraft) => void;
  showPreview?: boolean;
}

export function PushVariantForm({ variant, onChange, showPreview = true }: PushVariantFormProps) {
  const [showFreqOverride, setShowFreqOverride] = useState(variant.frequencyCapOverride !== null);

  const update = (patch: Partial<PushVariantDraft>) => onChange({ ...variant, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Variant Name</label>
        <Input
          className="mt-1"
          value={variant.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="e.g. V1 - Curiosity Hook"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Title</label>
        <Input
          className="mt-1"
          value={variant.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Push notification title"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Body</label>
        <textarea
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          rows={3}
          value={variant.body}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="Push notification body text"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Deeplink</label>
        <div className="mt-1">
          <DeeplinkSelect value={variant.deeplink} onChange={(v) => update({ deeplink: v })} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Icon Image URL</label>
        <Input
          className="mt-1"
          value={variant.iconImageUrl}
          onChange={(e) => update({ iconImageUrl: e.target.value })}
          placeholder="https://..."
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Preferred Send Hour</label>
          <Select
            value={variant.preferredHour !== null ? String(variant.preferredHour) : "none"}
            onValueChange={(v) => update({ preferredHour: v === "none" ? null : Number(v) })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Any hour" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Any hour</SelectItem>
              {HOURS.map((h) => (
                <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Preferred Send Day</label>
          <Select
            value={variant.preferredDayOfWeek !== null ? String(variant.preferredDayOfWeek) : "none"}
            onValueChange={(v) => update({ preferredDayOfWeek: v === "none" ? null : Number(v) })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Any day" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Any day</SelectItem>
              {DAYS.map((d) => (
                <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Frequency Cap Override</label>
          <Switch
            checked={showFreqOverride}
            onCheckedChange={(checked) => {
              setShowFreqOverride(checked);
              update({ frequencyCapOverride: checked ? { maxSends: 3, period: "week" } : null });
            }}
          />
        </div>
        {showFreqOverride && variant.frequencyCapOverride && (
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              min={1}
              max={30}
              className="w-20"
              value={variant.frequencyCapOverride.maxSends}
              onChange={(e) =>
                update({
                  frequencyCapOverride: { ...variant.frequencyCapOverride!, maxSends: Number(e.target.value) },
                })
              }
            />
            <span className="text-xs text-muted-foreground">sends per</span>
            <Select
              value={variant.frequencyCapOverride.period}
              onValueChange={(v) =>
                update({
                  frequencyCapOverride: {
                    ...variant.frequencyCapOverride!,
                    period: v as FrequencyCap["period"],
                  },
                })
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="biweek">2 Weeks</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {showPreview && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Preview</label>
          <div className="mt-2 bg-gray-100 rounded-xl p-4 flex justify-center">
            <PushNotificationPreview
              title={variant.title || undefined}
              body={variant.body}
              deeplink={variant.deeplink || undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
