"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const MOBILE_QUERY = "(max-width: 768px), (pointer: coarse)";

/** Live, SSR-safe "is this a mobile device" signal (server snapshot = false → desktop). */
function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

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
  /** When true, render a clickable header that collapses/expands the player. */
  collapsible?: boolean;
  /** Header label shown when `collapsible` is set. */
  title?: string;
  /** Initial open state for a collapsible player (default open). */
  defaultOpen?: boolean;
};

export function NexusVideoPlayer({
  basePath,
  lengths,
  defaultLength,
  defaultVoice = "heart",
  accent = "#ff3d4d",
  className,
  portrait = false,
  collapsible = false,
  title = "Watch",
  defaultOpen = true,
}: NexusVideoPlayerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [length, setLength] = useState(defaultLength ?? lengths[0].key);
  const [voice, setVoice] = useState(defaultVoice);
  // Aspect defaults to the device (mobile → 9:16, desktop → 16:9); a manual pick overrides it.
  const isMobile = useIsMobile();
  const [manualAspect, setManualAspect] = useState<string | null>(null);
  const aspect = manualAspect ?? (portrait && isMobile ? "tall" : "wide");
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

  const showBody = !collapsible || open;

  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden", className)}>
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        >
          <span className="text-sm font-semibold">{title}</span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open ? "" : "-rotate-90")}
          />
        </button>
      )}

      {showBody && (
        <>
      <div className={cn("bg-[#121212] flex justify-center", collapsible && "border-t", tall ? "py-4" : "aspect-video")}>
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
            onChange={setManualAspect}
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
        </>
      )}
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
