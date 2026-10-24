// The exact set of notifications that should be scheduled right now.
// Ids include a fingerprint of the content, so changed settings replace old notifications.
import {
  breakOverBodies,
  breakOverTitles,
  hash,
  pick,
  reminderBodies,
  reminderTitles,
} from './messages.ts';
import { isQuiet, MINUTE, nextQuietEnd, planBreaks } from './schedule.ts';
import type { AppData, Settings } from './types.ts';

export type PlannedNotification = {
  id: string;
  at: number;
  kind: 'due' | 'over' | 'out';
  title: string;
  body: string;
};

/** iOS keeps at most 64 pending; leave room for the break-over, last-call and test notifications. */
export const MAX_REMINDERS = 60;

/**
 * Android has no such limit (only ~500 alarms per app), so it books further ahead. The app
 * also tops the list up in the background before it runs low (see modules/quack-timer).
 */
export const MAX_REMINDERS_ANDROID = 150;

export const OUT_TITLE = 'Break reminders paused';
export const OUT_BODY = 'Open Quack Break to keep them coming.';

/**
 * Bump when notification content changes (its wording too), so booked notifications get
 * replaced. Android rebooks everything at each start anyway; iOS keeps what's booked.
 */
const CONTENT_VERSION = 6;

export function contentFingerprint(s: Settings): string {
  return hash(
    `${CONTENT_VERSION}|${s.startSound}|${s.startVibrate}|${s.endSound}|${s.endVibrate}|${s.voice}|${s.breakSec}|${s.snoozeMin}`,
  ).toString(36);
}

/**
 * Reminders, the break-over alert, and a last call: if the booked reminders ever run out
 * (the app wasn't opened and couldn't top them up), one more notification says so instead of
 * reminders silently stopping. Each sync moves it further out, so normally it never shows.
 */
export function planNotifications(data: AppData, now: number, max = MAX_REMINDERS): PlannedNotification[] {
  if (!data.onboarded) return [];
  const { settings, timer } = data;
  const fp = contentFingerprint(settings);
  const out: PlannedNotification[] = [];

  if (timer.breakEndsAt !== null && timer.breakEndsAt > now) {
    out.push({
      id: `over_${timer.breakEndsAt}_${fp}`,
      at: timer.breakEndsAt,
      kind: 'over',
      title: pick(breakOverTitles, timer.breakEndsAt),
      body: pick(breakOverBodies, timer.breakEndsAt + 1),
    });
  }

  const plan = planBreaks(now, settings, timer, { max });
  for (const at of plan.reminders) {
    out.push({
      id: `due_${at}_${fp}`,
      at,
      kind: 'due',
      title: pick(reminderTitles, at),
      body: pick(reminderBodies(settings.breakSec), at + 1),
    });
  }

  const last = plan.reminders[plan.reminders.length - 1];
  if (last !== undefined) {
    let at = last + settings.workMin * MINUTE;
    if (isQuiet(at, settings.quiet)) at = nextQuietEnd(at, settings.quiet);
    out.push({ id: `out_${at}_${fp}`, at, kind: 'out', title: OUT_TITLE, body: OUT_BODY });
  }
  return out;
}
