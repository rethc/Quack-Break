// Shared data shapes. Plain TypeScript so it runs in Node tests too.

export type QuietHours = {
  enabled: boolean;
  /** Minutes after midnight, local time. */
  startMin: number;
  endMin: number;
};

/**
 * The sound for a moment. "voice" uses the chosen voice, "phone" the phone's own notification
 * sound (Android only; people can pick any installed tone in Android's settings), "none" is silent.
 */
export type SoundId = 'quack' | 'voice' | 'chime' | 'drop' | 'bell' | 'beep' | 'phone' | 'none';

/** Voices for the "voice" sound (AI voices made with Kokoro, see scripts/make-voices.py). */
export type VoiceId = 'heart' | 'bella' | 'michael' | 'george';

/** The single alert style used before per-moment sounds (v0.2 dev builds). */
type OldAlertStyle = 'quack' | 'vibrate' | 'silent';

export type Settings = {
  /** Fixed 20 min / 20 s timing. Turning it off shows the custom timings. */
  rule202020: boolean;
  workMin: number;
  breakSec: number;
  snoozeMin: number;
  quiet: QuietHours;
  /** When a reminder arrives. */
  startSound: SoundId;
  startVibrate: boolean;
  /** When a break's time is up. */
  endSound: SoundId;
  endVibrate: boolean;
  /** Voice for both moments when their sound is "voice". */
  voice: VoiceId;
  /** Small vibrations when tapping buttons. */
  haptics: boolean;
};

export type TimerState = {
  /** Reminders repeat every `workMin` after this moment. */
  anchor: number;
  /** When the anchor was set. Quiet hours ending after this restarts the cadence. */
  setAt: number;
  /** Set while a break is running. */
  breakEndsAt: number | null;
};

export type AppData = {
  v: 1;
  onboarded: boolean;
  settings: Settings;
  timer: TimerState;
  /** Finished breaks per local day, keyed YYYY-MM-DD. */
  days: Record<string, number>;
  /** Recently handled notification responses, so none is applied twice. */
  handled: string[];
};

export const RULE_WORK_MIN = 20;
export const RULE_BREAK_SEC = 20;

export const DEFAULT_SETTINGS: Settings = {
  rule202020: true,
  workMin: RULE_WORK_MIN,
  breakSec: RULE_BREAK_SEC,
  snoozeMin: 5,
  quiet: { enabled: true, startMin: 22 * 60, endMin: 8 * 60 },
  startSound: 'quack',
  startVibrate: true,
  endSound: 'quack',
  endVibrate: true,
  voice: 'heart',
  haptics: true,
};

type SavedSettings = Partial<Settings> & { sound?: boolean; startAlert?: OldAlertStyle; endAlert?: OldAlertStyle };

const fromAlert = (a: OldAlertStyle) => ({ sound: (a === 'quack' ? 'quack' : 'none') as SoundId, vibrate: a !== 'silent' });

/** Fill in saved settings from older versions of the app. */
export function settingsFrom(saved: unknown): Settings {
  const raw: SavedSettings = { ...(saved as SavedSettings) };
  // v0.1 had one sound switch and one vibration switch for everything.
  const v1: OldAlertStyle | undefined =
    raw.sound === undefined ? undefined : raw.sound ? 'quack' : raw.haptics === false ? 'silent' : 'vibrate';
  const oldStart = raw.startAlert ?? v1;
  const oldEnd = raw.endAlert ?? v1;
  delete raw.sound;
  delete raw.startAlert;
  delete raw.endAlert;
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ...(oldStart && { startSound: fromAlert(oldStart).sound, startVibrate: fromAlert(oldStart).vibrate }),
    ...(oldEnd && { endSound: fromAlert(oldEnd).sound, endVibrate: fromAlert(oldEnd).vibrate }),
    ...raw,
    quiet: { ...DEFAULT_SETTINGS.quiet, ...raw.quiet },
  };
  if (raw.rule202020 === undefined) s.rule202020 = s.workMin === RULE_WORK_MIN && s.breakSec === RULE_BREAK_SEC;
  return s;
}

export function defaultData(now: number): AppData {
  return {
    v: 1,
    onboarded: false,
    settings: DEFAULT_SETTINGS,
    timer: { anchor: now, setAt: now, breakEndsAt: null },
    days: {},
    handled: [],
  };
}

export const WORK_CHOICES = [5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90];
export const BREAK_CHOICES = [10, 15, 20, 30, 40, 60, 90, 120];
export const SNOOZE_CHOICES = [5, 10, 15];
