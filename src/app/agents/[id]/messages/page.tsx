"use client";

import { useState, use } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mockAgents } from "@/lib/mock/agents";
import { Message, Channel } from "@/types/agent";
import { cn } from "@/lib/utils";
import { Trash2, Plus, Eye } from "lucide-react";

const CHANNELS: Channel[] = ["push", "email", "sms"];

const channelColors: Record<Channel, string> = {
  push: "bg-blue-100 text-blue-700",
  email: "bg-purple-100 text-purple-700",
  sms: "bg-green-100 text-green-700",
};

export default function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agent = mockAgents.find((a) => a.id === id);
  const [messages, setMessages] = useState<Message[]>(agent?.messages ?? []);
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState<Channel>("push");
  const [newBody, setNewBody] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const addMessage = () => {
    if (!newName.trim() || !newBody.trim()) return;
    const msg: Message = {
      id: `msg_${Date.now()}`,
      agentId: id,
      name: newName,
      channel: newChannel,
      createdAt: new Date().toISOString(),
      variants: [
        {
          id: `var_${Date.now()}`,
          messageId: `msg_${Date.now()}`,
          name: "V1",
          subject: newSubject || null,
          body: newBody,
          cta: null,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    setMessages((m) => [...m, msg]);
    setNewName("");
    setNewBody("");
    setNewSubject("");
  };

  const removeMessage = (msgId: string) => setMessages((m) => m.filter((x) => x.id !== msgId));

  return (
    <>
      <Header title="Messages & Variants" description={agent?.name} />
      <div className="p-6 max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Add Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Message name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1"
              />
              <Select value={newChannel} onValueChange={(v) => setNewChannel(v as Channel)}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newChannel === "email" && (
              <Input
                placeholder="Subject line"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
              />
            )}
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm resize-none h-20 bg-background"
              placeholder="Message body..."
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
            />
            <Button size="sm" onClick={addMessage} disabled={!newName.trim() || !newBody.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Message
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {messages.map((msg) => (
            <Card key={msg.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{msg.name}</p>
                    <Badge variant="outline" className={cn("text-xs capitalize", channelColors[msg.channel])}>
                      {msg.channel}
                    </Badge>
                    {msg.brazeCampaignId && (
                      <Badge variant="outline" className="text-xs">Braze: {msg.brazeCampaignId}</Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setPreview(preview === msg.id ? null : msg.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => removeMessage(msg.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {msg.variants?.map((v) => (
                    <div
                      key={v.id}
                      className={cn(
                        "p-3 rounded-lg border",
                        preview === msg.id ? "bg-muted" : "bg-muted/30"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{v.name}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            v.status === "active" ? "text-green-700 bg-green-50" : "text-yellow-700 bg-yellow-50"
                          )}
                        >
                          {v.status}
                        </Badge>
                      </div>
                      {v.subject && (
                        <p className="text-xs font-medium text-muted-foreground">Subject: {v.subject}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">{v.body}</p>
                      {v.cta && <p className="text-xs font-medium text-primary mt-1">CTA: {v.cta}</p>}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="h-7 text-xs w-full">
                    <Plus className="h-3 w-3 mr-1" />
                    Add Variant
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {messages.length > 0 && (
          <Button size="sm">Save Changes</Button>
        )}
      </div>
    </>
  );
}
