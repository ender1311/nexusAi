"use client";
import { useEffect, useState } from "react";

export type Speed = 1 | 2 | 4;
const BASE_MS_PER_DAY = 650; // 30 days ≈ 20 s at 1×

/** Steps a day index from 0 to `total`, at `speed`, while `playing`. */
export function usePlayback(total: number, runKey: string) {
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  useEffect(() => {
    setDay(0);
    setPlaying(false);
  }, [runKey]);

  useEffect(() => {
    if (!playing) return;
    if (day >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setDay((d) => d + 1), BASE_MS_PER_DAY / speed);
    return () => clearTimeout(t);
  }, [playing, day, total, speed]);

  return {
    day,
    playing,
    speed,
    setSpeed,
    play: () => { if (day >= total) setDay(0); setPlaying(true); },
    pause: () => setPlaying(false),
    reset: () => { setPlaying(false); setDay(0); },
  };
}
