// User-facing break actions: update the state, then re-sync notifications.
import { finishBreakIfDone, skipBreak, snooze, startBreak } from '@/core/transitions';

import { syncSchedule } from './notifications';
import { getData, updateData } from './storage';

export function beginBreak() {
  updateData((d) => startBreak(d, Date.now()));
  void syncSchedule();
}

/** Record the break if its time is up. Returns true if it was just counted. */
export function completeBreakIfDone(): boolean {
  const before = getData();
  return updateData((d) => finishBreakIfDone(d, Date.now())) !== before;
}

export function skipNow() {
  updateData((d) => skipBreak(d, Date.now()));
  void syncSchedule();
}

export function snoozeNow() {
  updateData((d) => snooze(d, Date.now()));
  void syncSchedule();
}
