"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";
import { AgentColorPicker } from "./agent-color-picker";

const ALGORITHM_OPTIONS = [
  { value: "thompson", label: "Thompson Sampling" },
  { value: "epsilon_greedy", label: "Epsilon-Greedy" },
  { value: "contextual", label: "Contextual Bandit" },
];

type Props = {
  agentId: string;
  initialName: string;
  initialDescription: string | null;
  initialAlgorithm: string;
  initialEpsilon: number;
  initialFunnelStage: FunnelStage;
  initialLanguageFilter: string;
  initialColor: string;
  usedColors: string[];
};

export function AgentEditSheet({
  agentId,
  initialName,
  initialDescription,
  initialAlgorithm,
  initialEpsilon,
  initialFunnelStage,
  initialLanguageFilter,
  initialColor,
  usedColors,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [algorithm, setAlgorithm] = useState(initialAlgorithm);
  const [epsilon, setEpsilon] = useState(initialEpsilon);
  const [funnelStage, setFunnelStage] = useState<FunnelStage>(initialFunnelStage);
  const [englishOnly, setEnglishOnly] = useState(initialLanguageFilter === "en");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          algorithm,
          epsilon,
          funnelStage,
          languageFilter: englishOnly ? "en" : "all",
        }),
      });
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        }
      />
      <SheetContent className="w-full sm:max-w-md flex flex-col overflow-hidden p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-base">Edit Agent</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Identity */}
          <section className="space-y-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Identity</p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
                rows={2}
                className="resize-none text-sm"
              />
            </div>
            <AgentColorPicker agentId={agentId} currentColor={initialColor} usedColors={usedColors} />
          </section>

          <div className="border-t" />

          {/* Configuration */}
          <section className="space-y-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Configuration</p>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Algorithm</label>
              <Select value={algorithm} onValueChange={(v) => { if (v) setAlgorithm(v); }}>
                <SelectTrigger className="w-full">
                  <span className="flex-1 text-left text-sm truncate">
                    {ALGORITHM_OPTIONS.find((a) => a.value === algorithm)?.label ?? algorithm}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {ALGORITHM_OPTIONS.map((algo) => (
                    <SelectItem key={algo.value} value={algo.value}>
                      {algo.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {algorithm === "epsilon_greedy" && (
              <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Exploration rate</label>
                  <span className="text-sm font-mono tabular-nums text-muted-foreground">
                    {(epsilon * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={[epsilon]}
                  onValueChange={(v) => setEpsilon(Array.isArray(v) ? v[0] : v)}
                />
                <p className="text-xs text-muted-foreground">Fraction of sends used for random exploration vs. exploiting the best variant.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Funnel Stage</label>
              <Select
                value={funnelStage}
                onValueChange={(v) => { if (v) setFunnelStage(v as FunnelStage); }}
              >
                <SelectTrigger className="w-full">
                  <span className="flex-1 text-left text-sm truncate">
                    {FUNNEL_STAGE_META[funnelStage].label}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {FUNNEL_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {FUNNEL_STAGE_META[stage].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Determines which users this agent targets.</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-3">
              <div>
                <p className="text-sm font-medium">English only</p>
                <p className="text-xs text-muted-foreground mt-0.5">Restrict to users with language starting with &quot;en&quot;</p>
              </div>
              <Switch checked={englishOnly} onCheckedChange={setEnglishOnly} />
            </div>
          </section>
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t px-6 py-4 bg-background flex gap-2">
          <Button
            className="flex-1"
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save Changes"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
