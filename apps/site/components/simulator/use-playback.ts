"use client";
import { useEffect, useState } from "react";

export type Speed = 1 | 2 | 4;
const BASE_MS_PER_DAY = 650; // 30 days ≈ 20 s at 1×

/** Steps a day index from 0 to `total`, at `speed`, while `playing`. */
export function usePlayback(total: number, runKey: string) {
  const [day, setDay] = useState(0);
  const [wantsPlay, setWantsPlay] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [seenRunKey, setSeenRunKey] = useState(runKey);

  // Adjust state during render when the run changes, rather than in an effect.
  if (seenRunKey !== runKey) {
    setSeenRunKey(runKey);
    setDay(0);
    setWantsPlay(false);
  }

  // Reaching the final day stops playback without any state write.
  const playing = wantsPlay && day < total;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setDay((d) => d + 1), BASE_MS_PER_DAY / speed);
    return () => clearTimeout(t);
  }, [playing, day, speed]);

  return {
    day,
    playing,
    speed,
    setSpeed,
    play: () => { if (day >= total) setDay(0); setWantsPlay(true); },
    pause: () => setWantsPlay(false),
    reset: () => { setWantsPlay(false); setDay(0); },
  };
}
