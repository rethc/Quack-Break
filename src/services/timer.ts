// Keeps the Android timer notification in step with the schedule, and applies its Stop button.
import type { PlannedNotification } from '@/core/notificationPlan';
import { resumeReminders, skipBreak, stopReminders } from '@/core/transitions';
import type { AppData } from '@/core/types';

import { onTimerAction, setTimerPlan, takeTimerActions, timerAvailable } from '../../modules/quack-timer';
import { updateData } from './storage';

export { onTimerAction, timerAvailable };

const TEXT = {
  nextTitle: 'Next break in',
  nextAtTitle: 'Next break at %s',
  breakTitle: 'Eye break',
  stopLabel: 'Stop',
  stoppedTitle: 'Reminders stopped',
  stoppedText: 'No break reminders until you resume.',
  resumeLabel: 'Resume',
  channelName: 'Timer',
};

/** Apply buttons pressed on the notification. Run before reading or syncing the schedule. */
export function applyTimerActions() {
  for (const a of takeTimerActions()) {
    updateData((d) =>
      a.type === 'stop' ? stopReminders(d, a.at) : a.type === 'resume' ? resumeReminders(d, a.at) : skipBreak(d, a.at),
    );
  }
}

/**
 * Hand the schedule to the native side: the tray countdown (if on), tidying old reminders out
 * of the tray, and the background top-up at `refillAt`. With data null, everything is off.
 */
export function updateTimer(data: AppData | null, planned: readonly PlannedNotification[] = [], refillAt = 0) {
  if (!timerAvailable) return;
  const ready = !!data && data.onboarded;
  setTimerPlan({
    ...TEXT,
    enabled: ready && data.settings.trayTimer,
    paused: ready && !!data.timer.paused,
    breakEndsAt: ready ? (data.timer.breakEndsAt ?? 0) : 0,
    overId: planned.find((n) => n.kind === 'over')?.id ?? '',
    reminders: planned.filter((n) => n.kind === 'due').map((n) => n.at),
    refillAt: ready ? refillAt : 0,
  });
}
