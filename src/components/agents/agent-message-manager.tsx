"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PushVariantForm, PushVariantDraft } from "@/components/agents/push-variant-form";
import { PushVariantPreviewCard } from "@/components/agents/push-variant-preview-card";
import { TemplatePicker } from "@/components/agents/template-picker";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { FrequencyCap } from "@/types/agent";

type VariantRecord = {
  id: string;
  name: string;
  title: string | null;
  body: string | null;
  deeplink: string | null;
  iconImageUrl: string | null;
  preferredHour: number | null;
  preferredDayOfWeek: number | null;
  frequencyCapOverride: FrequencyCap | null;
  status: string;
  brazeVariantId: string | null;
  warmupUntil: string | null;
};

type MessageRecord = {
  id: string;
  name: string;
  channel: string;
  brazeCampaignId: string | null;
  variants: VariantRecord[];
};

type AgentMessageManagerProps = {
  agentId: string;
  initialMessages: MessageRecord[];
};

const EMPTY_VARIANT: PushVariantDraft = {
  name: "V1",
  body: "",
  title: "",
  deeplink: "",
  iconImageUrl: "",
  preferredHour: null,
  preferredDayOfWeek: null,
  frequencyCapOverride: null,
};

function toDraft(variant: VariantRecord): PushVariantDraft {
  return {
    name: variant.name,
    body: variant.body ?? "",
    title: variant.title ?? "",
    deeplink: variant.deeplink ?? "",
    iconImageUrl: variant.iconImageUrl ?? "",
    preferredHour: variant.preferredHour,
    preferredDayOfWeek: variant.preferredDayOfWeek,
    frequencyCapOverride: variant.frequencyCapOverride,
  };
}

function toPayload(variant: PushVariantDraft) {
  return {
    name: variant.name.trim(),
    body: variant.body.trim(),
    title: variant.title.trim() || null,
    deeplink: variant.deeplink.trim() || null,
    iconImageUrl: variant.iconImageUrl.trim() || null,
    preferredHour: variant.preferredHour,
    preferredDayOfWeek: variant.preferredDayOfWeek,
    frequencyCapOverride: variant.frequencyCapOverride,
  };
}

function isValidVariant(variant: PushVariantDraft): boolean {
  return variant.name.trim().length > 0 && variant.body.trim().length > 0;
}

function normalizeVariant(variant: VariantRecord): VariantRecord {
  return {
    ...variant,
    frequencyCapOverride:
      variant.frequencyCapOverride &&
      typeof variant.frequencyCapOverride === "object" &&
      "maxSends" in variant.frequencyCapOverride &&
      "period" in variant.frequencyCapOverride
        ? variant.frequencyCapOverride
        : null,
  };
}

function normalizeMessage(message: MessageRecord): MessageRecord {
  return {
    ...message,
    variants: message.variants.map(normalizeVariant),
  };
}

export function AgentMessageManager({ agentId, initialMessages }: AgentMessageManagerProps) {
  const [messages, setMessages] = useState<MessageRecord[]>(initialMessages.map(normalizeMessage));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);

  const [addVariantForMessageId, setAddVariantForMessageId] = useState<string | null>(null);
  const [newVariantDraft, setNewVariantDraft] = useState<PushVariantDraft>({ ...EMPTY_VARIANT });

  const [editingVariant, setEditingVariant] = useState<{ messageId: string; variant: VariantRecord } | null>(null);
  const [editingDraft, setEditingDraft] = useState<PushVariantDraft>({ ...EMPTY_VARIANT });

  async function refreshMessages() {
    try {
      const res = await fetch(`/api/agents/${agentId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as MessageRecord[];
      setMessages(data.map(normalizeMessage));
    } catch {
      // silent — user can refresh page if needed
    }
  }

  async function addVariant() {
    if (!addVariantForMessageId || !isValidVariant(newVariantDraft)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: addVariantForMessageId,
          variant: toPayload(newVariantDraft),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to add variant" }));
        throw new Error(body.error ?? "Failed to add variant");
      }
      const updatedMessage = (await res.json()) as MessageRecord;
      setMessages((prev) =>
        prev.map((msg) => (msg.id === updatedMessage.id ? normalizeMessage(updatedMessage) : msg)),
      );
      setNewVariantDraft({ ...EMPTY_VARIANT });
      setAddVariantForMessageId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add variant");
    } finally {
      setSaving(false);
    }
  }

  async function saveVariantEdit() {
    if (!editingVariant || !isValidVariant(editingDraft)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/variants/${editingVariant.variant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toPayload(editingDraft),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update variant" }));
        throw new Error(body.error ?? "Failed to update variant");
      }
      const body = await res.json();
      const updatedVariant = normalizeVariant(body.data as VariantRecord);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id !== editingVariant.messageId
            ? msg
            : {
                ...msg,
                variants: msg.variants.map((v) => (v.id === updatedVariant.id ? { ...v, ...updatedVariant } : v)),
              },
        ),
      );
      setEditingVariant(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update variant");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVariant(messageId: string, variantId: string) {
    const shouldDelete = window.confirm("Delete this variant?");
    if (!shouldDelete) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/variants/${variantId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to delete variant" }));
        throw new Error(body.error ?? "Failed to delete variant");
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id !== messageId
            ? msg
            : {
                ...msg,
                variants: msg.variants.filter((v) => v.id !== variantId),
              },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete variant");
    } finally {
      setSaving(false);
    }
  }

  function openVariantEditor(messageId: string, variant: VariantRecord) {
    setEditingVariant({ messageId, variant });
    setEditingDraft(toDraft(variant));
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Create and manage push messages and their variants directly in Nexus.</p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Message
              </Button>
            }
          />
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Push Message from Templates</DialogTitle>
            </DialogHeader>
            <TemplatePicker agentId={agentId} onSaved={() => { setCreateOpen(false); refreshMessages(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {error && !editingVariant && !addVariantForMessageId && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {messages.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
          <p className="font-medium">No messages configured yet</p>
          <p className="text-sm mt-1">Create a push message to start adding and testing variants.</p>
        </div>
      ) : (
        messages.map((msg) => (
          <Card key={msg.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm font-semibold">{msg.name}</CardTitle>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs capitalize",
                      msg.channel === "push" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                      msg.channel === "email" && "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
                    )}
                  >
                    {msg.channel}
                  </Badge>
                  {msg.brazeCampaignId && (
                    <Badge variant="outline" className="text-xs font-mono">
                      campaign: {msg.brazeCampaignId.slice(0, 8)}…
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{msg.variants.length} variants</span>
                  <Dialog
                    open={addVariantForMessageId === msg.id}
                    onOpenChange={(open) => {
                      setAddVariantForMessageId(open ? msg.id : null);
                      if (!open) setNewVariantDraft({ ...EMPTY_VARIANT, name: `V${msg.variants.length + 1}` });
                    }}
                  >
                    <DialogTrigger
                      render={
                        <Button size="sm" variant="outline">
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Add Variant
                        </Button>
                      }
                    />
                    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Add Variant to {msg.name}</DialogTitle>
                      </DialogHeader>
                      <PushVariantForm variant={newVariantDraft} onChange={setNewVariantDraft} />
                      {error && <p className="text-sm text-destructive">{error}</p>}
                      <DialogFooter>
                        <Button variant="outline" onClick={() => { setAddVariantForMessageId(null); setError(null); }}>
                          Cancel
                        </Button>
                        <Button onClick={addVariant} disabled={!isValidVariant(newVariantDraft) || saving}>
                          Save Variant
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {msg.variants.map((variant) => (
                <div key={variant.id} className="space-y-2">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => openVariantEditor(msg.id, variant)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteVariant(msg.id, variant.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete
                    </Button>
                  </div>
                  <PushVariantPreviewCard variant={variant} channel={msg.channel} />
                </div>
              ))}
              {msg.variants.length === 0 && (
                <p className="text-sm text-muted-foreground border rounded-lg p-4 text-center">
                  No variants yet. Add your first variant for this message.
                </p>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={editingVariant !== null} onOpenChange={(open) => !open && setEditingVariant(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Variant</DialogTitle>
          </DialogHeader>
          <PushVariantForm variant={editingDraft} onChange={setEditingDraft} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingVariant(null); setError(null); }}>
              Cancel
            </Button>
            <Button onClick={saveVariantEdit} disabled={!isValidVariant(editingDraft) || saving}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
