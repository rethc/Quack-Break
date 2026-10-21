// Tiny persistent store: one JSON file, read and written synchronously.
// Data is a few hundred bytes and changes a few times an hour, so this is plenty fast.
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { defaultData, DEFAULT_SETTINGS, type AppData } from '@/core/types';

const FILE_NAME = 'quack-state.json';
const TMP_NAME = 'quack-state.tmp';

let current: AppData | null = null;
const listeners = new Set<() => void>();

function readFromDisk(): AppData {
  const now = Date.now();
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return defaultData(now);
    const raw = JSON.parse(file.textSync()) as Partial<AppData>;
    const base = defaultData(now);
    return {
      ...base,
      ...raw,
      settings: { ...DEFAULT_SETTINGS, ...raw.settings, quiet: { ...DEFAULT_SETTINGS.quiet, ...raw.settings?.quiet } },
      timer: { ...base.timer, ...raw.timer },
      days: raw.days ?? {},
      handled: raw.handled ?? [],
      v: 1,
    };
  } catch (e) {
    console.warn('Could not read saved state, starting fresh', e);
    return defaultData(now);
  }
}

function writeToDisk(data: AppData) {
  const json = JSON.stringify(data);
  try {
    // Write a temp file, then swap it in, so a crash mid-write can't corrupt the state.
    const tmp = new File(Paths.document, TMP_NAME);
    tmp.writeSync(json);
    tmp.moveSync(new File(Paths.document, FILE_NAME), { overwrite: true });
  } catch {
    try {
      new File(Paths.document, FILE_NAME).writeSync(json);
    } catch (e) {
      console.warn('Could not save state', e);
    }
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
