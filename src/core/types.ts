// Shared data shapes. Plain TypeScript so it runs in Node tests too.

export type QuietHours = {
  enabled: boolean;
  /** Minutes after midnight, local time. */
  startMin: number;
  endMin: number;
};

export type Settings = {
  workMin: number;
  breakSec: number;
  snoozeMin: number;
  quiet: QuietHours;
  sound: boolean;
  haptics: boolean;
};

export type TimerState = {
  /** Reminders repeat every `workMin` after this moment. */
  anchor: number;
  /** When the anchor was set. Quiet hours ending after this restarts the cadence. */
  setAt: number;
  /** Set while a break is running. */
  breakEndsAt: number | null;
};

export type AppData = {
  v: 1;
  onboarded: boolean;
  settings: Settings;
  timer: TimerState;
  /** Finished breaks per local day, keyed YYYY-MM-DD. */
  days: Record<string, number>;
  /** Recently handled notification responses, so none is applied twice. */
  handled: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  workMin: 20,
  breakSec: 20,
  snoozeMin: 5,
  quiet: { enabled: true, startMin: 22 * 60, endMin: 8 * 60 },
  sound: true,
  haptics: true,
};

export function defaultData(now: number): AppData {
  return {
    v: 1,
    onboarded: false,
    settings: DEFAULT_SETTINGS,
    timer: { anchor: now, setAt: now, breakEndsAt: null },
    days: {},
    handled: [],
  };
}

export const WORK_CHOICES = [5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90];
export const BREAK_CHOICES = [10, 15, 20, 30, 40, 60, 90, 120];
export const SNOOZE_CHOICES = [5, 10, 15];
