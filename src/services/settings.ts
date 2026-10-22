import { updateSettings } from '@/core/transitions';
import type { Settings } from '@/core/types';

import { syncSchedule } from './notifications';
import { updateData } from './storage';

let syncTimer: ReturnType<typeof setTimeout> | undefined;

/** Save a settings change now; rebuild the schedule once the user stops tapping. */
export function saveSettings(patch: Partial<Settings>) {
  updateData((d) => updateSettings(d, patch));
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncSchedule(), 600);
}
