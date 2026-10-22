// JS side of the Android timer notification (see android/). The native module is missing on
// iOS and on builds made before it existed, so every call here quietly does nothing there.
import { requireOptionalNativeModule } from 'expo';

/** What the notification should show. Times are epoch milliseconds. */
export type TimerPlan = {
  enabled: boolean;
  /** End of the running break, or 0. */
  breakEndsAt: number;
  /** Id of the booked "break over" notification, cancelled if the break is stopped early. */
  overId: string;
  /** Upcoming reminder times. */
  reminders: number[];
  nextTitle: string;
  /** Shown when the next break is hours away; %s becomes the time. */
  nextAtTitle: string;
  breakTitle: string;
  stopLabel: string;
  channelName: string;
};

/** A Stop press on the notification: "stop" between breaks, "endBreak" during one. */
export type TimerAction = { type: 'stop' | 'endBreak'; at: number };

type NativeTimer = {
  setPlan(json: string): void;
  takeActions(): string;
  addListener(event: 'onAction', listener: () => void): { remove(): void };
};

const native = requireOptionalNativeModule<NativeTimer>('QuackTimer');

export const timerAvailable = native != null;

export function setTimerPlan(plan: TimerPlan) {
  try {
    native?.setPlan(JSON.stringify(plan));
  } catch (e) {
    console.warn('Could not update the timer notification', e);
  }
}

/** Stop presses since last time. Each is returned once. */
export function takeTimerActions(): TimerAction[] {
  if (!native) return [];
  try {
    const list = JSON.parse(native.takeActions()) as TimerAction[];
    return Array.isArray(list) ? list.filter((a) => a.type === 'stop' || a.type === 'endBreak') : [];
  } catch {
    return [];
  }
}

/** Called when Stop is pressed while the app is running. Returns an unsubscribe function. */
export function onTimerAction(listener: () => void): () => void {
  const sub = native?.addListener('onAction', listener);
  return () => sub?.remove();
}
