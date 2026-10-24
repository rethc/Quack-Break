// State changes for the break cycle. Pure: (data, now) -> new data.
import { countBreak, markSeen, rename, wear, type ItemId } from './pond.ts';
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

/**
 * Counts a break whose time is up, for today and toward the pond. Returns the same object if
 * there was nothing to finish.
 */
export function finishBreakIfDone(data: AppData, now: number): AppData {
  const endsAt = data.timer.breakEndsAt;
  if (endsAt === null || endsAt > now) return data;
  const key = dayKey(endsAt);
  const days = { ...data.days, [key]: (data.days[key] ?? 0) + 1 };
  const keys = Object.keys(days);
  if (keys.length > KEEP_DAYS) {
    for (const k of keys.sort().slice(0, keys.length - KEEP_DAYS)) delete days[k];
  }
  return { ...data, days, pond: countBreak(data.pond, endsAt), timer: { ...data.timer, breakEndsAt: null } };
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

/** Start reminders again, counting from now (or from the end of a break that's still running). */
export function resumeReminders(data: AppData, now: number): AppData {
  const d = finishBreakIfDone(data, now);
  const running = d.timer.breakEndsAt;
  return { ...d, timer: { anchor: running ?? now, setAt: now, breakEndsAt: running } };
}

export function finishOnboarding(data: AppData, now: number): AppData {
  const d = finishBreakIfDone(data, now);
  return { ...d, onboarded: true, timer: { anchor: now, setAt: now, breakEndsAt: null } };
}

/**
 * A new reminder interval counts from now. Otherwise going from 60 to 10 minutes could make a
 * break overdue at once, with no reminder ever sent.
 */
export function updateSettings(data: AppData, patch: Partial<Settings>, now: number): AppData {
  const d = finishBreakIfDone(data, now);
  const settings = { ...d.settings, ...patch };
  if (settings.workMin === d.settings.workMin) return { ...d, settings };
  const t = d.timer;
  const from = Math.max(now, t.breakEndsAt ?? 0);
  return {
    ...d,
    settings,
    timer: { anchor: from, setAt: now, breakEndsAt: t.breakEndsAt, ...(t.paused && { paused: true }) },
  };
}

/** Put on (or take off, if already worn) a hat or scarf. Locked or non-wearable items are ignored. */
export function wearItem(data: AppData, id: ItemId | null): AppData {
  const pond = wear(data.pond, id);
  return pond === data.pond ? data : { ...data, pond };
}

export function renameDuck(data: AppData, name: string): AppData {
  const pond = rename(data.pond, name);
  return pond === data.pond ? data : { ...data, pond };
}

/** The user looked at their pond: nothing is new any more. */
export function markPondSeen(data: AppData): AppData {
  const pond = markSeen(data.pond);
  return pond === data.pond ? data : { ...data, pond };
}

export function rememberHandled(data: AppData, key: string): AppData {
  return { ...data, handled: [...data.handled.slice(-29), key] };
}

export function breaksOn(data: AppData, t: number): number {
  return data.days[dayKey(t)] ?? 0;
}
