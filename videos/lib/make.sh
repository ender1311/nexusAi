#!/usr/bin/env bash
# Build + render a HyperFrames video in every shipped voice.
# Usage: bash ../lib/make.sh <projectDir> <outBaseName>
# Produces <projectDir>/out/<outBaseName>__<voiceKey>.mp4 for each voice.
set -euo pipefail

DIR="$1"
NAME="$2"
cd "$DIR"
mkdir -p out

# voiceKey : kokoroVoiceId
VOICES=(
  "heart:af_heart"
  "michael:am_michael"
  "emma:bf_emma"
)

for entry in "${VOICES[@]}"; do
  key="${entry%%:*}"
  voice="${entry##*:}"
  echo "=== building $NAME [$key / $voice] ==="
  node ../lib/build.mjs . "$voice"
  npx -y hyperframes render --output "out/${NAME}__${key}.mp4" --quiet
  echo "=== rendered out/${NAME}__${key}.mp4 ==="
done
echo "ALL DONE: $NAME"
ls -la out/
