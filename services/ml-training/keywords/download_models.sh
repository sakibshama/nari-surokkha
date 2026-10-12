#!/usr/bin/env bash
# Downloads every source model the keyword pipeline needs into $KWS_MODELS
# (default: ./work/models). All are public and Apache-2.0 / MIT / CC licensed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
M="${KWS_MODELS:-$HERE/work/models}"
mkdir -p "$M/oww" && cd "$M"
REL=https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models
for v in vits-piper-en_US-libritts_r-medium vits-piper-en_GB-vctk-medium vits-piper-en_US-arctic-medium \
         vits-piper-en_GB-southern_english_female-medium vits-piper-en_US-hfc_female-medium vits-piper-en_US-hfc_male-medium \
         vits-piper-en_US-lessac-medium vits-piper-en_US-ryan-high vits-piper-en_GB-alan-medium vits-piper-en_US-amy-low \
         vits-mimic3-bn-multi_low vits-coqui-bn-custom_female vits-piper-hi_IN-pratham-medium vits-piper-hi_IN-priyamvada-medium \
         vits-piper-ne_NP-google-medium vits-piper-ne_NP-chitwan-medium; do
  [ -d "$v" ] || { curl -fsSL "$REL/$v.tar.bz2" | tar xj; }
done
# Real recordings used for YAMNet checks and as background noise
AT=https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models
[ -d sherpa-onnx-zipformer-small-audio-tagging-2024-04-15 ] || curl -fsSL "$AT/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15.tar.bz2" | tar xj
# Google speech_embedding front-end (openWakeWord packaging)
OWW=https://github.com/dscripka/openWakeWord/releases/download/v0.5.1
for f in melspectrogram.onnx embedding_model.onnx embedding_model.tflite; do
  [ -f "oww/$f" ] || curl -fsSL -o "oww/$f" "$OWW/$f"
done
# YAMNet (Google, Apache-2.0). Canonical source: Kaggle Models google/yamnet (tflite/classification).
# The app ships apps/mobile/assets/models/yamnet.tflite; copy it so the eval scripts can find it.
cp -n "$HERE/../../../apps/mobile/assets/models/yamnet.tflite" "$M/yamnet.tflite" || true
echo "models in $M"
