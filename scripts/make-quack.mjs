// Generates assets/sounds/quack.wav: a short, original, synthesized "quack-quack".
// No dependencies. Run: node scripts/make-quack.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const RATE = 22050;

function quack(durationSec, f0Start, f0End) {
  const n = Math.floor(durationSec * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Pitch falls a little over the quack, with a tiny wobble.
    const f0 = f0Start + (f0End - f0Start) * Math.pow(t, 0.7) + 6 * Math.sin(2 * Math.PI * 23 * (i / RATE));
    phase += (2 * Math.PI * f0) / RATE;
    // Band-limited sawtooth: buzzy and nasal.
    let s = 0;
    for (let h = 1; h * f0 < RATE / 2.2 && h <= 18; h++) s += Math.sin(h * phase) / h;
    // Fast "rasp" amplitude modulation.
    s *= 0.75 + 0.25 * Math.sin(2 * Math.PI * 38 * (i / RATE));
    // Envelope: quick attack, short hold, soft release.
    const attack = Math.min(1, t / 0.06);
    const release = t > 0.55 ? Math.pow(1 - (t - 0.55) / 0.45, 1.6) : 1;
    out[i] = s * attack * release;
  }
  return out;
}

// Resonant band-pass (RBJ biquad) to shape the "duck" formants.
function bandpass(input, freq, q) {
  const w0 = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

function shape(src) {
  const f1 = bandpass(src, 1150, 5);
  const f2 = bandpass(src, 2500, 7);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = 1.0 * f1[i] + 0.6 * f2[i] + 0.12 * src[i];
  return out;
}

const gap = new Float32Array(Math.floor(0.07 * RATE));
const parts = [shape(quack(0.17, 560, 400)), gap, shape(quack(0.2, 520, 360))];
const total = parts.reduce((a, p) => a + p.length, 0);
const mix = new Float32Array(total);
let o = 0;
for (const p of parts) { mix.set(p, o); o += p.length; }

// Normalize to about -3 dBFS.
let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
const gain = 0.7 / (peak || 1);

const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i] * gain)) * 32767), i * 2);

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

mkdirSync('assets/sounds', { recursive: true });
writeFileSync('assets/sounds/quack.wav', Buffer.concat([header, data]));
console.log(`assets/sounds/quack.wav: ${(total / RATE).toFixed(2)} s, ${((44 + data.length) / 1024).toFixed(1)} KB`);
