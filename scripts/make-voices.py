"""Generates the voice clips in assets/sounds with Kokoro-82M (open-source TTS, Apache 2.0).

Each voice says "Time to rest." (break reminder) and "Time to work." (break over).
Clips are trimmed, leveled to about -1 dBFS and saved as 16-bit mono WAV.

Setup (one time, about 350 MB):
    pip install kokoro-onnx soundfile
    download kokoro-v1.0.onnx and voices-v1.0.bin from
    https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Run from the project root:
    python scripts/make-voices.py <folder with the two model files> [<extra site-packages folder>]
"""

import os
import sys

if len(sys.argv) > 2:
    sys.path.insert(0, sys.argv[2])

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODELS = sys.argv[1]
OUT = "assets/sounds"

# App name -> (Kokoro voice, accent)
VOICES = {
    "heart": ("af_heart", "en-us"),
    "bella": ("af_bella", "en-us"),
    "michael": ("am_michael", "en-us"),
    "george": ("bm_george", "en-gb"),
}
PHRASES = {"rest": "Time to rest.", "work": "Time to work."}

kokoro = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))
os.makedirs(OUT, exist_ok=True)

for name, (voice, lang) in VOICES.items():
    for key, text in PHRASES.items():
        audio, rate = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
        a = np.asarray(audio, dtype=np.float32)
        loud = np.where(np.abs(a) > 0.02)[0]
        if len(loud):
            a = a[max(0, loud[0] - int(0.03 * rate)) : min(len(a), loud[-1] + int(0.12 * rate))]
        a = a / max(1e-6, float(np.max(np.abs(a)))) * 0.89
        fade = int(0.01 * rate)
        a[:fade] *= np.linspace(0, 1, fade)
        a[-fade:] *= np.linspace(1, 0, fade)
        path = os.path.join(OUT, f"voice_{name}_{key}.wav")
        sf.write(path, a, rate, subtype="PCM_16")
        print(f"{path}: {len(a) / rate:.2f} s, {os.path.getsize(path) / 1024:.1f} KB")
