#!/usr/bin/env node
// Data-driven narration builder for HyperFrames videos.
// Per-sentence Kokoro TTS → padded concat → exact, voice-independent timings.
//
// Usage: node ../lib/build.mjs <projectDir> <voice> [gapSeconds]
// Reads   <projectDir>/beats.json  = [{ "text": "...", "scene": 1 }, ...]
// Writes  <projectDir>/narration.wav
//         <projectDir>/timings.js   (window.__VIDEO_TIMINGS = {...})

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const [, , projectDirArg, voiceArg, gapArg] = process.argv;
if (!projectDirArg || !voiceArg) {
  console.error("Usage: node build.mjs <projectDir> <voice> [gapSeconds]");
  process.exit(1);
}
const projectDir = resolve(projectDirArg);
const voice = voiceArg;
const GAP = gapArg ? parseFloat(gapArg) : 0.26;
const LEAD = 0.45; // scene fades in this long before its first word
const TAIL = 0.7; // hold after last word

const beats = JSON.parse(readFileSync(join(projectDir, "beats.json"), "utf8"));
const tmp = join(projectDir, ".tts-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

function ffprobeDuration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]).toString().trim();
  return parseFloat(out);
}

// Kokoro TTS occasionally crashes a single beat (transient). Retry before giving up.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function ttsWithRetry(text, raw, attempts = 4) {
  for (let a = 1; a <= attempts; a++) {
    try {
      execFileSync("npx", ["-y", "hyperframes", "tts", text, "--voice", voice, "--output", raw], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      return;
    } catch (e) {
      if (a === attempts) throw e;
      process.stderr.write(`\n  tts beat retry ${a}/${attempts - 1}...\n`);
      sleepSync(2000);
    }
  }
}

// 1) TTS each beat, pad with trailing gap, normalize format.
const padded = [];
const durations = [];
beats.forEach((b, i) => {
  const raw = join(tmp, `s${i}.wav`);
  ttsWithRetry(b.text, raw);
  const d = ffprobeDuration(raw);
  durations.push(d);
  const pad = join(tmp, `p${i}.wav`);
  execFileSync("ffmpeg", [
    "-y", "-i", raw, "-af", `apad=pad_dur=${GAP}`, "-ar", "24000", "-ac", "1", pad,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  padded.push(pad);
  process.stderr.write(`  beat ${i + 1}/${beats.length} (${d.toFixed(2)}s)\r`);
});
process.stderr.write("\n");

// 2) Concat padded clips into narration.wav
const listFile = join(tmp, "list.txt");
writeFileSync(listFile, padded.map((p) => `file '${p}'`).join("\n"));
const narration = join(projectDir, "narration.wav");
execFileSync("ffmpeg", [
  "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", narration,
], { stdio: ["ignore", "ignore", "ignore"] });

// 3) Compute timings. Beat i starts at the cumulative sum of (dur + gap) of prior beats.
let t = 0;
const beatTimings = beats.map((b, i) => {
  const start = t;
  const end = start + durations[i];
  t = end + GAP;
  return { text: b.caption ?? b.text, scene: b.scene, start: round(start), end: round(end) };
});
const total = round(t - GAP + TAIL);

// 4) Scene fade/hide windows.
const sceneIds = [...new Set(beats.map((b) => b.scene))].sort((a, b) => a - b);
const scenes = {};
let prevId = null;
sceneIds.forEach((id, idx) => {
  const first = beatTimings.find((bt) => bt.scene === id);
  const fadeStart = idx === 0 ? 0 : Math.max(0, round(first.start - LEAD));
  scenes[id] = { fadeStart, hideAt: null };
  if (prevId !== null) scenes[prevId].hideAt = round(fadeStart + 0.6);
  prevId = id;
});
scenes[prevId].hideAt = null; // last scene: no hard hide (final fade in composition)

const audioDuration = round(ffprobeDuration(narration));
const payload = {
  voice,
  total,
  audioDuration,
  scenes,
  beats: beatTimings,
};
writeFileSync(
  join(projectDir, "timings.js"),
  "window.__VIDEO_TIMINGS = " + JSON.stringify(payload, null, 2) + ";\n",
);

// 5) Patch index.html root + audio durations for this voice.
const indexPath = join(projectDir, "index.html");
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, "utf8");
  html = html.replace(
    /(<div id="root"[^>]*?data-duration=")[^"]*(")/,
    `$1${total}$2`,
  );
  html = html.replace(
    /(<audio id="vo"[^>]*?data-duration=")[^"]*(")/,
    `$1${audioDuration}$2`,
  );
  writeFileSync(indexPath, html);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`✓ ${voice}: ${beats.length} beats · narration ${audioDuration}s · total ${total}s`);

function round(n) { return Math.round(n * 1000) / 1000; }
