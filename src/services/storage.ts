// Tiny persistent store: one JSON file, read and written synchronously.
// Data is a few hundred bytes and changes a few times an hour, so this is plenty fast.
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { defaultData, settingsFrom, timerFrom, type AppData } from '@/core/types';

const FILE_NAME = 'quack-state.json';
const TMP_NAME = 'quack-state.tmp';
/** The previous good state, used if the main file is ever unreadable. */
const BACKUP_NAME = 'quack-state.bak';

let current: AppData | null = null;
const listeners = new Set<() => void>();

/** Parses and checks a saved state file. Throws if it's missing or unreadable. */
function parse(file: File, now: number): AppData {
  const raw = JSON.parse(file.textSync()) as Partial<AppData> | null;
  if (!raw || typeof raw !== 'object') throw new Error('Saved state is not an object');
  const settings = settingsFrom(raw.settings);
  const days: Record<string, number> = {};
  if (raw.days && typeof raw.days === 'object') {
    for (const [k, v] of Object.entries(raw.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(v) && v > 0) days[k] = v;
    }
  }
  return {
    v: 1,
    onboarded: raw.onboarded === true,
    settings,
    timer: timerFrom(raw.timer, settings, now),
    days,
    handled: Array.isArray(raw.handled) ? raw.handled.filter((h) => typeof h === 'string').slice(-30) : [],
  };
}

function readFromDisk(): AppData {
  const now = Date.now();
  const main = new File(Paths.document, FILE_NAME);
  const backup = new File(Paths.document, BACKUP_NAME);
  if (!main.exists && !backup.exists) return defaultData(now);
  try {
    return parse(main, now);
  } catch (e) {
    console.warn('Saved state is unreadable, trying the backup', e);
  }
  try {
    const data = parse(backup, now);
    // Remove the damaged file first, so saving doesn't copy it over the good backup.
    try {
      main.delete();
    } catch {
      // Already gone.
    }
    writeToDisk(data);
    return data;
  } catch (e) {
    console.warn('Could not read saved state, starting fresh', e);
    return defaultData(now);
  }
}

function writeToDisk(data: AppData) {
  const json = JSON.stringify(data);
  try {
    // Write a temp file, keep the last good state as the backup, then swap the new one in.
    // A crash at any point leaves at least one complete file.
    const tmp = new File(Paths.document, TMP_NAME);
    tmp.writeSync(json);
    const main = new File(Paths.document, FILE_NAME);
    if (main.exists) main.copySync(new File(Paths.document, BACKUP_NAME), { overwrite: true });
    tmp.moveSync(new File(Paths.document, FILE_NAME), { overwrite: true });
  } catch (e) {
    console.warn('Could not save state', e);
  }
}

export function getData(): AppData {
  if (!current) current = readFromDisk();
  return current;
}

/** Re-read from disk, e.g. after a background task changed it. */
export function reloadData() {
  current = readFromDisk();
  listeners.forEach((l) => l());
}

export function updateData(fn: (d: AppData) => AppData): AppData {
  const prev = getData();
  const next = fn(prev);
  if (next !== prev) {
    current = next;
    writeToDisk(next);
    listeners.forEach((l) => l());
  }
  return next;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to part of the state. The selector must return something already in the state (no new objects). */
export function useData<T>(selector: (d: AppData) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getData()));
}
