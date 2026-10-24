// JS side of the Android timer notification (see android/). The native module is missing on
// iOS and on builds made before it existed, so every call here quietly does nothing there.
import { requireOptionalNativeModule } from 'expo';

/** What the notification should show. Times are epoch milliseconds. */
export type TimerPlan = {
  /** Show the countdown notification (the tray timer setting). */
  enabled: boolean;
  /** Reminders are stopped: show "Reminders stopped" with Resume instead of a countdown. */
  paused: boolean;
  /** End of the running break, or 0. */
  breakEndsAt: number;
  /** Id of the booked "break over" notification, cancelled if the break is stopped early. */
  overId: string;
  /** Upcoming reminder times. Also used to clear older reminders out of the tray. */
  reminders: number[];
  /** When to run the JS sync in the background to book more reminders, or 0. */
  refillAt: number;
  nextTitle: string;
  /** Shown when the next break is hours away; %s becomes the time. */
  nextAtTitle: string;
  breakTitle: string;
  stopLabel: string;
  stoppedTitle: string;
  stoppedText: string;
  resumeLabel: string;
  channelName: string;
};

/** A button pressed on the notification: Stop between breaks, Stop during one, or Resume. */
export type TimerAction = { type: 'stop' | 'endBreak' | 'resume'; at: number };
const ACTION_TYPES: readonly string[] = ['stop', 'endBreak', 'resume'];

type NativeTimer = {
  setPlan(json: string): void;
  takeActions(): string;
  playSound?(sound: string, channelId: string | null): void;
  stopSound?(): void;
  addListener(event: 'onAction', listener: () => void): { remove(): void };
};

const native = requireOptionalNativeModule<NativeTimer>('QuackTimer');

export const timerAvailable = native != null;

/** One-at-a-time sound previews (builds from before this existed don't have it). */
export const soundPreviewAvailable = typeof native?.playSound === 'function';

/** Play a preview, stopping any that's playing. `sound` is a file name or "default" (phone sound). */
export function playPreviewSound(sound: string, channelId: string | null = null) {
  try {
    native?.playSound?.(sound, channelId);
  } catch (e) {
    console.warn('Could not play the sound preview', e);
  }
}

export function stopPreviewSound() {
  try {
    native?.stopSound?.();
  } catch {
    // Nothing to stop.
  }
}

export function setTimerPlan(plan: TimerPlan) {
  try {
    native?.setPlan(JSON.stringify(plan));
  } catch (e) {
    console.warn('Could not update the timer notification', e);
  }
}

/** Buttons pressed since last time. Each is returned once. */
export function takeTimerActions(): TimerAction[] {
  if (!native) return [];
  try {
    const list = JSON.parse(native.takeActions()) as TimerAction[];
    return Array.isArray(list) ? list.filter((a) => ACTION_TYPES.includes(a.type)) : [];
  } catch {
    return [];
  }
}

/**
 * Called while the app's JS is running when a notification button is pressed, or when the
 * schedule should be topped up. Returns an unsubscribe function.
 */
export function onTimerAction(listener: () => void): () => void {
  const sub = native?.addListener('onAction', listener);
  return () => sub?.remove();
}
