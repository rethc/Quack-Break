// When are breaks due? Pure functions, no React Native.
import type { QuietHours, Settings, TimerState } from './types.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

function quietActive(q: QuietHours): boolean {
  return q.enabled && q.startMin !== q.endMin;
}

const wallMinutes = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};
const sameDate = (a: number, b: number) => new Date(a).getDate() === new Date(b).getDate();

/**
 * Local time `min` minutes after midnight, `dayOffset` days from the day of `base`. On the days
 * the clocks change: a time that doesn't exist (clocks went forward past it) is the moment they
 * jumped; a time that happens twice (clocks went back) is its first or last occurrence, as asked.
 */
export function atMinuteOfDay(base: number, dayOffset: number, min: number, which: 'first' | 'last' = 'first'): number {
  const d = new Date(base);
  let t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, Math.floor(min / 60), min % 60).getTime();
  if (wallMinutes(t) !== min) {
    // Skipped by the clocks going forward: step back to the first moment past it.
    while (wallMinutes(t - MINUTE) >= min && sameDate(t - MINUTE, t)) t -= MINUTE;
    return t;
  }
  // Repeated by the clocks going back (by an hour, or half an hour on Lord Howe Island).
  for (const shift of [60 * MINUTE, 30 * MINUTE]) {
    if (which === 'first' && wallMinutes(t - shift) === min && sameDate(t - shift, t)) return t - shift;
    if (which === 'last' && wallMinutes(t + shift) === min && sameDate(t + shift, t)) return t + shift;
  }
  return t;
}

/** Quiet hours that start on the day `dayOffset` days from `t`: [start, end) as moments in time. */
function quietSpan(t: number, dayOffset: number, q: QuietHours): [number, number] {
  const start = atMinuteOfDay(t, dayOffset, q.startMin, 'first');
  const end = atMinuteOfDay(t, q.startMin < q.endMin ? dayOffset : dayOffset + 1, q.endMin, 'last');
  return [start, end];
}

/**
 * Inside quiet hours. On the days the clocks change, quiet hours run from the first time their
 * start is reached to the last time their end is reached, so they never end early or twice.
 */
export function isQuiet(t: number, q: QuietHours): boolean {
  if (!quietActive(q)) return false;
  for (const off of [0, -1]) {
    const [start, end] = quietSpan(t, off, q);
    if (t >= start && t < end) return true;
  }
  return false;
}

// Quiet hours really end at their end time unless the next night's already started there. That
// happens on a clock-change night with quiet hours that leave a gap shorter than the change.

/** The latest moment at or before `t` when quiet hours ended. */
export function lastQuietEnd(t: number, q: QuietHours): number | null {
  if (!quietActive(q)) return null;
  for (const off of [0, -1, -2, -3]) {
    const end = atMinuteOfDay(t, off, q.endMin, 'last');
    if (end <= t && !isQuiet(end, q)) return end;
  }
  return null;
}

/** The first moment after `t` when quiet hours end. */
export function nextQuietEnd(t: number, q: QuietHours): number {
  for (const off of [0, 1, 2, 3]) {
    const end = atMinuteOfDay(t, off, q.endMin, 'last');
    if (end > t && !isQuiet(end, q)) return end;
  }
  return t + 24 * HOUR;
}

/**
 * Start of the cadence. If quiet hours ended since the anchor was set, count from then, except
 * when a snooze is still to ring after that end: a snooze rings when it was promised. An end
 * before the anchor (during a break, which anchors at its end) changes nothing.
 */
export function cadenceStart(now: number, timer: TimerState, q: QuietHours, work = 0): number {
  const end = lastQuietEnd(now, q);
  if (end === null || end <= timer.setAt || end <= timer.anchor) return timer.anchor;
  if (timer.snoozed && end < timer.anchor + work) return timer.anchor;
  return end;
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
  const horizon = now + (opts.horizonMs ?? 8 * 24 * HOUR);
  const work = settings.workMin * MINUTE;
  const q = settings.quiet;
  const quietNow = isQuiet(now, q);
  const breakActive = timer.breakEndsAt !== null && timer.breakEndsAt > now;
  const start = cadenceStart(now, timer, q, work);
  const dueAt = start + work;
  if (timer.paused) return { overdue: false, quietNow, breakActive, dueAt, reminders: [] };
  // A snooze the user asked for rings even if it lands in quiet hours (only the snooze itself:
  // once quiet hours have restarted the cadence, the flag no longer applies).
  const snoozedRing = (t: number) => !!timer.snoozed && start === timer.anchor && t === dueAt;
  const overdue = !breakActive && now >= dueAt && (!quietNow || snoozedRing(dueAt));

  // First reminder strictly in the future.
  let next = dueAt;
  if (next <= now) next += Math.floor((now - next) / work + 1) * work;

  // The cadence point before `next`: if quiet hours ended after it, the cadence restarts there.
  let prev = next - work;
  const reminders: number[] = [];
  for (let guard = 0; reminders.length < max && next <= horizon && guard < 5000; guard++) {
    if (!snoozedRing(next)) {
      if (isQuiet(next, q)) {
        next = nextQuietEnd(next, q) + work;
        prev = next - work;
        continue;
      }
      // Quiet hours that started and ended between two reminders (e.g. a lunch break).
      const end = lastQuietEnd(next, q);
      if (end !== null && end > prev) {
        next = end + work;
        prev = end;
        continue;
      }
    }
    reminders.push(next);
    prev = next;
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
