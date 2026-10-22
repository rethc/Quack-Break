// Sounds and voices people can pick, and which file each moment plays.
// Every file here must also be listed in the expo-notifications plugin in app.json.
import type { Settings, SoundId, VoiceId } from './types.ts';

export type Moment = 'start' | 'end';

export const SOUND_OPTIONS: readonly { value: SoundId; label: string }[] = [
  { value: 'quack', label: 'Quack' },
  { value: 'voice', label: 'Voice' },
  { value: 'chime', label: 'Chime' },
  { value: 'drop', label: 'Drop' },
  { value: 'bell', label: 'Bell' },
  { value: 'beep', label: 'Beep' },
  { value: 'phone', label: 'Phone sound' },
  { value: 'none', label: 'None' },
];

/** Sounds only Android can play: iPhone apps can't use the phone's own tones. */
export const ANDROID_ONLY_SOUNDS: readonly SoundId[] = ['phone'];

export const VOICE_OPTIONS: readonly { value: VoiceId; label: string }[] = [
  { value: 'heart', label: 'Heart' },
  { value: 'bella', label: 'Bella' },
  { value: 'michael', label: 'Michael' },
  { value: 'george', label: 'George' },
];

/** Short description of a moment's sound for the Settings row, e.g. "Voice · Bella". */
export function soundLabel(m: Moment, s: Settings): string {
  const id = m === 'start' ? s.startSound : s.endSound;
  const label = SOUND_OPTIONS.find((o) => o.value === id)?.label ?? id;
  if (id !== 'voice') return label;
  return `${label} · ${VOICE_OPTIONS.find((v) => v.value === s.voice)?.label ?? s.voice}`;
}

export const soundOf = (m: Moment, s: Settings): SoundId => (m === 'start' ? s.startSound : s.endSound);
export const vibrateOf = (m: Moment, s: Settings): boolean => (m === 'start' ? s.startVibrate : s.endVibrate);

/**
 * The sound a moment plays: a file in assets/sounds, "default" for the phone's own sound,
 * or null for none. The voice says "Time to rest" or "Time to work".
 */
export function soundFile(m: Moment, s: Settings): string | null {
  const id = soundOf(m, s);
  if (id === 'none') return null;
  if (id === 'phone') return 'default';
  if (id === 'voice') return `voice_${s.voice}_${m === 'start' ? 'rest' : 'work'}.wav`;
  return `${id}.wav`;
}
