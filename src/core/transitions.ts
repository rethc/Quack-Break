// State changes for the break cycle. Pure: (data, now) -> new data.
import { dayKey, MINUTE } from './schedule.ts';
import type { AppData, Settings } from './types.ts';

const KEEP_DAYS = 400;

export function startBreak(data: AppData, now: number): AppData {
  if (data.timer.breakEndsAt !== null && data.timer.breakEndsAt > now) return data;
  const endsAt = now + data.settings.breakSec * 1000;
  // Anchor at the break's end so the schedule stays right even if the app is closed mid-break.
  return { ...data, timer: { anchor: endsAt, setAt: now, breakEndsAt: endsAt } };
}

/** Counts a break whose time is up. Returns the same object if there was nothing to finish. */
export function finishBreakIfDone(data: AppData, now: number): AppData {
  const endsAt = data.timer.breakEndsAt;
  if (endsAt === null || endsAt > now) return data;
  const key = dayKey(endsAt);
  const days = { ...data.days, [key]: (data.days[key] ?? 0) + 1 };
  const keys = Object.keys(days);
  if (keys.length > KEEP_DAYS) {
    for (const k of keys.sort().slice(0, keys.length - KEEP_DAYS)) delete days[k];
  }
  return { ...data, days, timer: { ...data.timer, breakEndsAt: null } };
}

/** Skip the due or running break. No guilt: nothing is recorded. */
export function skipBreak(data: AppData, now: number): AppData {
  return { ...data, timer: { anchor: now, setAt: now, breakEndsAt: null } };
}

/** Next reminder in `snoozeMin`, then the usual cadence. */
export function snooze(data: AppData, now: number): AppData {
  const { snoozeMin, workMin } = data.settings;
  return {
    ...data,
    timer: { anchor: now + (snoozeMin - workMin) * MINUTE, setAt: now, breakEndsAt: null },
  };
}

export function finishOnboarding(data: AppData, now: number): AppData {
  return { ...data, onboarded: true, timer: { anchor: now, setAt: now, breakEndsAt: null } };
}

export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return { ...data, settings: { ...data.settings, ...patch } };
}

export function rememberHandled(data: AppData, key: string): AppData {
  return { ...data, handled: [...data.handled.slice(-29), key] };
}

export function breaksOn(data: AppData, t: number): number {
  return data.days[dayKey(t)] ?? 0;
}
