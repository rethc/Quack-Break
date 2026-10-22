import { updateSettings } from '@/core/transitions';
import type { Settings } from '@/core/types';

import { syncSchedule } from './notifications';
import { updateData } from './storage';

let syncTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Save a settings change now; rebuild the schedule once the user stops tapping. With
 * `sync: false` the caller syncs later (the sound picker does it when it closes, so rebooking
 * reminders never holds up a sound preview).
 */
export function saveSettings(patch: Partial<Settings>, { sync = true } = {}) {
  updateData((d) => updateSettings(d, patch));
  if (!sync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncSchedule(), 600);
}
