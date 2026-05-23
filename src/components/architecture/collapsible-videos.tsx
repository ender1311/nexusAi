"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

type VideoItem = {
  id: string;
  title: string;
};

export function CollapsibleVideos({
  heading,
  videos,
}: {
  heading: string;
  videos: VideoItem[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Video className="h-4 w-4 text-[#57a16c]" />
          {heading}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          className="h-7 text-xs text-muted-foreground gap-1"
        >
          {open ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Show videos
            </>
          )}
        </Button>
      </div>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {videos.map((v) => (
            <div key={v.id} className="space-y-1.5">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${v.id}`}
                className="w-full aspect-video rounded-lg border"
                allowFullScreen
                title={v.title}
              />
              <p className="text-xs text-muted-foreground text-center">{v.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
