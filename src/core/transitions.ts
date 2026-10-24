// State changes for the break cycle. Pure: (data, now) -> new data.
import { dayKey, MINUTE } from './schedule.ts';
import type { AppData, Settings } from './types.ts';

const KEEP_DAYS = 400;

// Every change below first counts a break whose time is up, so breaks taken from the
// notification (where the app never sees them end) still count.

export function startBreak(data: AppData, now: number): AppData {
  if (data.timer.breakEndsAt !== null && data.timer.breakEndsAt > now) return data;
  const d = finishBreakIfDone(data, now);
  const endsAt = now + d.settings.breakSec * 1000;
  // Anchor at the break's end so the schedule stays right even if the app is closed mid-break.
  // A break taken while reminders are stopped doesn't start them again.
  return {
    ...d,
    timer: { anchor: endsAt, setAt: now, breakEndsAt: endsAt, ...(d.timer.paused && { paused: true }) },
  };
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
  const d = finishBreakIfDone(data, now);
  return { ...d, timer: { anchor: now, setAt: now, breakEndsAt: null, ...(d.timer.paused && { paused: true }) } };
}

/** Next reminder in `snoozeMin`, then the usual cadence. */
export function snooze(data: AppData, now: number): AppData {
  const d = finishBreakIfDone(data, now);
  const { snoozeMin, workMin } = d.settings;
  return {
    ...d,
    timer: { anchor: now + (snoozeMin - workMin) * MINUTE, setAt: now, breakEndsAt: null, snoozed: true },
  };
}

/** Stop all reminders until resumed (Stop on the timer notification). Ends a running break. */
export function stopReminders(data: AppData, now: number): AppData {
  const d = finishBreakIfDone(data, now);
  return { ...d, timer: { anchor: now, setAt: now, breakEndsAt: null, paused: true } };
}

/** Start reminders again, counting from now. */
export function resumeReminders(data: AppData, now: number): AppData {
  const d = finishBreakIfDone(data, now);
  return { ...d, timer: { anchor: now, setAt: now, breakEndsAt: null } };
}

export function finishOnboarding(data: AppData, now: number): AppData {
  return { ...data, onboarded: true, timer: { anchor: now, setAt: now, breakEndsAt: null } };
}

/**
 * A new reminder interval counts from now. Otherwise going from 60 to 10 minutes could make a
 * break overdue at once, with no reminder ever sent.
 */
export function updateSettings(data: AppData, patch: Partial<Settings>, now: number): AppData {
  const settings = { ...data.settings, ...patch };
  if (settings.workMin === data.settings.workMin) return { ...data, settings };
  const t = data.timer;
  const from = Math.max(now, t.breakEndsAt ?? 0);
  return {
    ...data,
    settings,
    timer: { anchor: from, setAt: now, breakEndsAt: t.breakEndsAt, ...(t.paused && { paused: true }) },
  };
}

export function rememberHandled(data: AppData, key: string): AppData {
  return { ...data, handled: [...data.handled.slice(-29), key] };
}

export function breaksOn(data: AppData, t: number): number {
  return data.days[dayKey(t)] ?? 0;
}
