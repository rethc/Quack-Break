// Android only: lets "Snooze" and "Start" work without opening the app, and tops up the booked
// reminders when the timer module asks (see TimerReceiver's refill alarm), so they never run
// out while the app stays closed. Must be imported from the entry file (index.ts).
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { completeBreakIfDone } from './breaks';
import { ACTION_SNOOZE, ACTION_START, applyResponse, syncSchedule } from './notifications';
import { reloadData } from './storage';
import { applyTimerActions } from './timer';

const HANDLED: readonly string[] = [ACTION_SNOOZE, ACTION_START];

const TASK = 'quack-notification-actions';

if (Platform.OS === 'android') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
    if (error || !data) return Notifications.BackgroundNotificationTaskResult.NoData;
    // Snooze, and Start (the break then runs in the tray timer). A plain tap opens the app instead.
    const action = 'actionIdentifier' in data && HANDLED.includes(data.actionIdentifier);
    const refill = (data as Record<string, unknown>).quackRefill === true;
    if (!action && !refill) return Notifications.BackgroundNotificationTaskResult.NoData;
    reloadData();
    applyTimerActions();
    completeBreakIfDone();
    if (action) applyResponse(data as Notifications.NotificationResponse, true);
    await syncSchedule();
    return Notifications.BackgroundNotificationTaskResult.NewData;
  });
  Notifications.registerTaskAsync(TASK).catch((e) => console.warn('Could not register notification task', e));
}
