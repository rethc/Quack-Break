// Keeps the Android timer notification in step with the schedule, and applies its Stop button.
import type { PlannedNotification } from '@/core/notificationPlan';
import { skipBreak, stopReminders } from '@/core/transitions';
import type { AppData } from '@/core/types';

import { onTimerAction, setTimerPlan, takeTimerActions, timerAvailable } from '../../modules/quack-timer';
import { updateData } from './storage';

export { onTimerAction, timerAvailable };

const TEXT = {
  nextTitle: 'Next break in',
  nextAtTitle: 'Next break at %s',
  breakTitle: 'Eye break',
  stopLabel: 'Stop',
  channelName: 'Timer',
};

/** Apply Stop presses made on the notification. Run before reading or syncing the schedule. */
export function applyTimerActions() {
  for (const a of takeTimerActions()) {
    updateData((d) => (a.type === 'stop' ? stopReminders(d, a.at) : skipBreak(d, a.at)));
  }
}

/** Show the countdown for the planned notifications, or hide it (data null, off, or stopped). */
export function updateTimer(data: AppData | null, planned: readonly PlannedNotification[] = []) {
  if (!timerAvailable) return;
  const on = !!data && data.onboarded && data.settings.trayTimer && !data.timer.paused;
  setTimerPlan({
    ...TEXT,
    enabled: on,
    breakEndsAt: on ? (data.timer.breakEndsAt ?? 0) : 0,
    overId: planned.find((n) => n.kind === 'over')?.id ?? '',
    reminders: on ? planned.filter((n) => n.kind === 'due').map((n) => n.at) : [],
  });
}
