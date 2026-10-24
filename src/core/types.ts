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
  /** Android: a live countdown in the notification tray, with a Stop button. */
  trayTimer: boolean;
};

export type TimerState = {
  /** Reminders repeat every `workMin` after this moment. */
  anchor: number;
  /** When the anchor was set. Quiet hours ending after this restarts the cadence. */
  setAt: number;
  /** Set while a break is running. */
  breakEndsAt: number | null;
  /** Reminders are stopped until the user resumes them. */
  paused?: boolean;
  /** The next reminder is a snooze the user asked for, so it rings even in quiet hours. */
  snoozed?: boolean;
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
  trayTimer: true,
};

type SavedSettings = Partial<Settings> & { sound?: boolean; startAlert?: OldAlertStyle; endAlert?: OldAlertStyle };

const SOUND_IDS: readonly SoundId[] = ['quack', 'voice', 'chime', 'drop', 'bell', 'beep', 'phone', 'none'];
const VOICE_IDS: readonly VoiceId[] = ['heart', 'bella', 'michael', 'george'];

const oneOf = <T>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const minuteOfDay = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60 ? v : fallback;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

const fromAlert = (a: OldAlertStyle) => ({ sound: (a === 'quack' ? 'quack' : 'none') as SoundId, vibrate: a !== 'silent' });

/**
 * Settings from the saved file: fills in what older versions didn't have, and replaces anything
 * that isn't a valid choice (a damaged file must never stop reminders, e.g. with workMin 0).
 */
export function settingsFrom(saved: unknown): Settings {
  const raw: SavedSettings = saved && typeof saved === 'object' ? { ...(saved as SavedSettings) } : {};
  // v0.1 had one sound switch and one vibration switch for everything.
  const v1: OldAlertStyle | undefined =
    raw.sound === undefined ? undefined : raw.sound ? 'quack' : raw.haptics === false ? 'silent' : 'vibrate';
  const oldStart = raw.startAlert ?? v1;
  const oldEnd = raw.endAlert ?? v1;
  delete raw.sound;
  delete raw.startAlert;
  delete raw.endAlert;
  const merged: SavedSettings = {
    ...(oldStart && { startSound: fromAlert(oldStart).sound, startVibrate: fromAlert(oldStart).vibrate }),
    ...(oldEnd && { endSound: fromAlert(oldEnd).sound, endVibrate: fromAlert(oldEnd).vibrate }),
    ...raw,
  };
  const d = DEFAULT_SETTINGS;
  const workMin = oneOf(merged.workMin, WORK_CHOICES, d.workMin);
  const breakSec = oneOf(merged.breakSec, BREAK_CHOICES, d.breakSec);
  const rule202020 = bool(merged.rule202020, workMin === RULE_WORK_MIN && breakSec === RULE_BREAK_SEC);
  const q: Partial<QuietHours> = merged.quiet && typeof merged.quiet === 'object' ? merged.quiet : {};
  let startMin = minuteOfDay(q.startMin, d.quiet.startMin);
  let endMin = minuteOfDay(q.endMin, d.quiet.endMin);
  // The same start and end would mean no quiet hours while the switch says on.
  if (startMin === endMin) [startMin, endMin] = [d.quiet.startMin, d.quiet.endMin];
  return {
    rule202020,
    workMin: rule202020 ? RULE_WORK_MIN : workMin,
    breakSec: rule202020 ? RULE_BREAK_SEC : breakSec,
    snoozeMin: oneOf(merged.snoozeMin, SNOOZE_CHOICES, d.snoozeMin),
    quiet: { enabled: bool(q.enabled, d.quiet.enabled), startMin, endMin },
    startSound: oneOf(merged.startSound, SOUND_IDS, d.startSound),
    startVibrate: bool(merged.startVibrate, d.startVibrate),
    endSound: oneOf(merged.endSound, SOUND_IDS, d.endSound),
    endVibrate: bool(merged.endVibrate, d.endVibrate),
    voice: oneOf(merged.voice, VOICE_IDS, d.voice),
    haptics: bool(merged.haptics, d.haptics),
    trayTimer: bool(merged.trayTimer, d.trayTimer),
  };
}

/**
 * The timer from the saved file, checked against the clock. If the clock went back (set by
 * hand, or a bad network time), saved times can sit far in the future, which would show a
 * break running for hours or push the next reminder out by a day. Nothing the app sets is more
 * than one break length ahead, so anything further is reset to now.
 */
export function timerFrom(saved: unknown, settings: Settings, now: number): TimerState {
  const raw: Partial<TimerState> = saved && typeof saved === 'object' ? (saved as Partial<TimerState>) : {};
  const ahead = now + settings.breakSec * 1000 + 5_000;
  const breakEndsAt = isTime(raw.breakEndsAt) && raw.breakEndsAt <= ahead ? raw.breakEndsAt : null;
  const anchorOk = isTime(raw.anchor) && raw.anchor <= ahead;
  const t: TimerState = {
    anchor: anchorOk ? (raw.anchor as number) : now,
    setAt: anchorOk && isTime(raw.setAt) ? Math.min(raw.setAt, now) : now,
    breakEndsAt,
  };
  if (raw.paused === true) t.paused = true;
  if (raw.snoozed === true && anchorOk) t.snoozed = true;
  return t;
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
