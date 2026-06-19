"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Option = { key: string; label: string; sublabel?: string };

const VOICES: Option[] = [
  { key: "heart", label: "Heart", sublabel: "warm" },
  { key: "michael", label: "Michael", sublabel: "deep" },
  { key: "emma", label: "Emma", sublabel: "British" },
];

const ASPECTS: Option[] = [
  { key: "wide", label: "16:9" },
  { key: "tall", label: "9:16" },
];

type NexusVideoPlayerProps = {
  /** Public path prefix, e.g. "/videos/nexus-about". Files resolve to `${basePath}-${length}__${voice}.mp4`. */
  basePath: string;
  lengths: Option[];
  defaultLength?: string;
  defaultVoice?: string;
  accent?: string;
  className?: string;
  /** When true, show a 16:9 / 9:16 aspect toggle. The 9:16 variant resolves to `${basePath}-portrait-${length}__${voice}.mp4`. */
  portrait?: boolean;
};

export function NexusVideoPlayer({
  basePath,
  lengths,
  defaultLength,
  defaultVoice = "heart",
  accent = "#ff3d4d",
  className,
  portrait = false,
}: NexusVideoPlayerProps) {
  const [length, setLength] = useState(defaultLength ?? lengths[0].key);
  const [voice, setVoice] = useState(defaultVoice);
  const [aspect, setAspect] = useState("wide");
  const videoRef = useRef<HTMLVideoElement>(null);

  const src = useMemo(() => {
    const base = portrait && aspect === "tall" ? `${basePath}-portrait` : basePath;
    return `${base}-${length}__${voice}.mp4`;
  }, [basePath, length, voice, aspect, portrait]);

  // Reload the element whenever the chosen variant changes.
  useEffect(() => {
    videoRef.current?.load();
  }, [src]);

  const tall = portrait && aspect === "tall";

  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden", className)}>
      <div className={cn("bg-[#121212] flex justify-center", tall ? "py-4" : "aspect-video")}>
        <video
          ref={videoRef}
          className={cn(tall ? "h-[70vh] max-h-[680px] aspect-[9/16]" : "h-full w-full")}
          controls
          playsInline
          preload="metadata"
        >
          <source src={src} type="video/mp4" />
        </video>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 border-t">
        <Segmented
          label="Length"
          options={lengths}
          value={length}
          onChange={setLength}
          accent={accent}
        />
        {portrait && (
          <Segmented
            label="Aspect"
            options={ASPECTS}
            value={aspect}
            onChange={setAspect}
            accent={accent}
          />
        )}
        <Segmented
          label="Voice"
          options={VOICES}
          value={voice}
          onChange={setVoice}
          accent={accent}
        />
      </div>
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
  accent,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (key: string) => void;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
        {options.map((o) => {
          const active = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(o.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                active ? "text-white" : "text-muted-foreground hover:text-foreground",
              )}
              style={active ? { background: accent } : undefined}
            >
              {o.label}
              {o.sublabel && (
                <span className={cn("ml-1.5 text-xs", active ? "text-white/70" : "text-muted-foreground/70")}>
                  {o.sublabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
