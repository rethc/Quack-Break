// When are breaks due? Pure functions, no React Native.
import type { QuietHours, Settings, TimerState } from './types.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function quietActive(q: QuietHours): boolean {
  return q.enabled && q.startMin !== q.endMin;
}

/** Local time `min` minutes after midnight, `dayOffset` days from the day of `base`. */
export function atMinuteOfDay(base: number, dayOffset: number, min: number): number {
  const d = new Date(base);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, Math.floor(min / 60), min % 60).getTime();
}

export function isQuiet(t: number, q: QuietHours): boolean {
  if (!quietActive(q)) return false;
  const m = minutesOfDay(t);
  return q.startMin < q.endMin ? m >= q.startMin && m < q.endMin : m >= q.startMin || m < q.endMin;
}

/** The latest moment at or before `t` when quiet hours ended. */
export function lastQuietEnd(t: number, q: QuietHours): number | null {
  if (!quietActive(q)) return null;
  for (const off of [0, -1]) {
    const end = atMinuteOfDay(t, off, q.endMin);
    if (end <= t) return end;
  }
  return null;
}

/** The first moment after `t` when quiet hours end. */
export function nextQuietEnd(t: number, q: QuietHours): number {
  for (const off of [0, 1]) {
    const end = atMinuteOfDay(t, off, q.endMin);
    if (end > t) return end;
  }
  return t + 24 * HOUR;
}

/** Start of the cadence. If quiet hours ended since the anchor was set, count from then. */
export function cadenceStart(now: number, timer: TimerState, q: QuietHours): number {
  const end = lastQuietEnd(now, q);
  return end !== null && end > timer.setAt ? end : timer.anchor;
}

export type BreakPlan = {
  /** A break is due now and the user hasn't taken, skipped or snoozed it. */
  overdue: boolean;
  quietNow: boolean;
  breakActive: boolean;
  /** When the next break is (or was) due. */
  dueAt: number;
  /** Future reminder times, quiet hours skipped. */
  reminders: number[];
};

export function planBreaks(
  now: number,
  settings: Settings,
  timer: TimerState,
  opts: { max?: number; horizonMs?: number } = {},
): BreakPlan {
  const max = opts.max ?? 60;
  const horizon = now + (opts.horizonMs ?? 48 * HOUR);
  const work = settings.workMin * MINUTE;
  const q = settings.quiet;
  const quietNow = isQuiet(now, q);
  const breakActive = timer.breakEndsAt !== null && timer.breakEndsAt > now;
  const start = cadenceStart(now, timer, q);
  const dueAt = start + work;
  const overdue = !quietNow && !breakActive && now >= dueAt;

  // First reminder strictly in the future.
  let next = dueAt;
  if (next <= now) next += Math.floor((now - next) / work + 1) * work;

  const reminders: number[] = [];
  for (let guard = 0; reminders.length < max && next <= horizon && guard < 5000; guard++) {
    if (isQuiet(next, q)) {
      next = nextQuietEnd(next, q) + work;
      continue;
    }
    reminders.push(next);
    next += work;
  }
  return { overdue, quietNow, breakActive, dueAt, reminders };
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(t: number): string {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
