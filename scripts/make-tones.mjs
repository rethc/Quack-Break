// Generates the alert tones in assets/sounds: chime, drop, bell and beep.
// Original, synthesized sounds (no samples, no licenses). Same format and loudness as quack.wav.
// No dependencies. Run: node scripts/make-tones.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;
const TAU = 2 * Math.PI;

/** A struck note: a few partials, each fading out at its own rate. */
function note(freq, seconds, partials) {
  const n = Math.floor(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.004);
    let s = 0;
    for (const [ratio, amp, decay] of partials) s += amp * Math.exp(-t / decay) * Math.sin(TAU * freq * ratio * t);
    out[i] = s * attack;
  }
  return out;
}

/** Mix clips into one buffer, each starting at its own time (seconds). */
function mix(seconds, clips) {
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (const [start, clip, gain = 1] of clips) {
    const o = Math.floor(start * RATE);
    for (let i = 0; i < clip.length && o + i < out.length; i++) out[o + i] += clip[i] * gain;
  }
  return out;
}

/** Soft chime: two gentle rising notes. */
function chime() {
  const soft = [
    [1, 1, 0.45],
    [2, 0.2, 0.25],
    [3, 0.06, 0.15],
  ];
  return mix(1.1, [
    [0, note(659.25, 1.1, soft)], // E5
    [0.17, note(880, 0.93, soft)], // A5
  ]);
}

/** Water drop: a quick upward "plip", then a smaller one. */
function drop() {
  const plip = (from, to, seconds) => {
    const n = Math.floor(seconds * RATE);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const f = to + (from - to) * Math.exp(-t / 0.012); // pitch jumps up fast, then holds
      phase += (TAU * f) / RATE;
      const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.045);
      out[i] = Math.sin(phase) * env;
    }
    return out;
  };
  return mix(0.45, [
    [0, plip(450, 1500, 0.25)],
    [0.16, plip(600, 1900, 0.25), 0.55],
  ]);
}

/** Bell: one clear strike with the slightly uneven overtones of a real bell. */
function bell() {
  const out = note(587.33, 1.6, [
    [0.5, 0.3, 1.4], // hum
    [1, 1, 1.0], // prime, D5
    [1.19, 0.4, 0.7],
    [1.5, 0.22, 0.6],
    [2, 0.45, 0.45],
    [2.52, 0.14, 0.3],
    [3.01, 0.08, 0.22],
  ]);
  // Fade the last 0.2 s so it ends cleanly.
  const fade = Math.floor(0.2 * RATE);
  for (let i = 0; i < fade; i++) out[out.length - fade + i] *= 1 - i / fade;
  return out;
}

/** Beep: two short timer beeps. */
function beep() {
  const one = () => {
    const n = Math.floor(0.11 * RATE);
    const out = new Float32Array(n);
    const edge = Math.floor(0.006 * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = Math.min(1, i / edge, (n - i) / edge);
      out[i] = (Math.sin(TAU * 1046.5 * t) + 0.25 * Math.sin(TAU * 3 * 1046.5 * t)) * env; // C6
    }
    return out;
  };
  return mix(0.3, [
    [0, one()],
    [0.18, one()],
  ]);
}

function writeWav(name, samples) {
  // Normalize to about -3 dBFS, like quack.wav.
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = 0.7 / (peak || 1);
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), i * 2);
  }
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
  const path = `assets/sounds/${name}.wav`;
  writeFileSync(path, Buffer.concat([header, data]));
  console.log(`${path}: ${(samples.length / RATE).toFixed(2)} s, ${((44 + data.length) / 1024).toFixed(1)} KB`);
}

mkdirSync('assets/sounds', { recursive: true });
writeWav('chime', chime());
writeWav('drop', drop());
writeWav('bell', bell());
writeWav('beep', beep());
