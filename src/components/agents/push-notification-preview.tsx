"use client";

import { useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Matches {{${first_name} | default: '...'}} or {{${first_name}}}
const BRAZE_FIRST_NAME_REGEX = /\{\{\$\{first_name\}[^}]*\}\}/g;
const BRAZE_FIRST_NAME_DEFAULT_REGEX = /\{\{\$\{first_name\}\s*\|\s*default:\s*['"]([^'"]+)['"]\s*\}\}/;

function hasPersonalization(content: string): boolean {
  return /\{\{\$\{first_name\}/.test(content);
}

function resolveWithName(content: string, name = "Friend"): string {
  return content.replace(BRAZE_FIRST_NAME_REGEX, name);
}

function resolveWithoutName(content: string): string {
  return content.replace(BRAZE_FIRST_NAME_DEFAULT_REGEX, "$1")
    .replace(BRAZE_FIRST_NAME_REGEX, "Friend");
}

function NotificationCard({ title, body, deeplink, imageUrl }: { title: string; body: string; deeplink?: string | null; imageUrl?: string }) {
  return (
    <div className="w-full max-w-[400px]">
      <div className="overflow-hidden rounded-2xl bg-[#e8e8e8] p-3 font-sans shadow-sm">
        <div className="flex items-start gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://air-prod.imgix.net/836ed311-f54b-4463-a1f4-b1628a91ca30.jpg?w=97&h=97&fm=png&fit=crop"
            alt="Bible App"
            className="h-10 w-10 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="truncate text-[15px] font-semibold text-[#1a1a1a]">
                {title || "Untitled"}
              </span>
              <span className="ml-2 shrink-0 text-[13px] text-[#8e8e93]">now</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[15px] leading-[1.35] text-[#3c3c3c]">
              {body || "Your message body will appear here."}
            </p>
          </div>
        </div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Push image" className="mt-2 w-full rounded-lg object-cover" />
        )}
      </div>
      {deeplink && (
        <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <LinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-wider uppercase">Deeplink</p>
            <span className="font-mono text-[11px] break-all text-primary">{deeplink}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface PushNotificationPreviewProps {
  title?: string | null;
  body: string;
  deeplink?: string | null;
  imageUrl?: string;
  previewName?: string;
}

export function PushNotificationPreview({ title, body, deeplink, imageUrl, previewName = "Alex" }: PushNotificationPreviewProps) {
  const [tab, setTab] = useState<"personalized" | "fallback">("personalized");

  const t = title ?? "";
  const personalized = hasPersonalization(t) || hasPersonalization(body);

  if (!personalized) {
    return <NotificationCard title={t} body={body} deeplink={deeplink} imageUrl={imageUrl} />;
  }

  return (
    <div className="space-y-2">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "personalized" | "fallback")}>
        <TabsList className="h-7">
          <TabsTrigger value="personalized" className="text-xs px-2 py-0.5">With Name</TabsTrigger>
          <TabsTrigger value="fallback" className="text-xs px-2 py-0.5">Without Name</TabsTrigger>
        </TabsList>
        <TabsContent value="personalized" className="mt-2">
          <NotificationCard
            title={resolveWithName(t, previewName)}
            body={resolveWithName(body, previewName)}
            deeplink={deeplink}
            imageUrl={imageUrl}
          />
        </TabsContent>
        <TabsContent value="fallback" className="mt-2">
          <NotificationCard
            title={resolveWithoutName(t)}
            body={resolveWithoutName(body)}
            deeplink={deeplink}
            imageUrl={imageUrl}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
