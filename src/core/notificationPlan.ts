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
import { planBreaks } from './schedule.ts';
import type { AppData, Settings } from './types.ts';

export type PlannedNotification = {
  id: string;
  at: number;
  kind: 'due' | 'over';
  title: string;
  body: string;
};

/** iOS keeps at most 64 pending; leave room for the break-over and test notifications. */
export const MAX_REMINDERS = 60;

/** Bump when notification content changes shape, so booked notifications get replaced. */
const CONTENT_VERSION = 3;

export function contentFingerprint(s: Settings): string {
  return hash(
    `${CONTENT_VERSION}|${s.startSound}|${s.startVibrate}|${s.endSound}|${s.endVibrate}|${s.voice}|${s.breakSec}|${s.snoozeMin}`,
  ).toString(36);
}

export function planNotifications(data: AppData, now: number): PlannedNotification[] {
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

  const plan = planBreaks(now, settings, timer, { max: MAX_REMINDERS });
  for (const at of plan.reminders) {
    out.push({
      id: `due_${at}_${fp}`,
      at,
      kind: 'due',
      title: pick(reminderTitles, at),
      body: pick(reminderBodies(settings.breakSec), at + 1),
    });
  }
  return out;
}
