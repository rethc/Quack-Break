// Android only: lets "Snooze" and "Start" work without opening the app.
// Must be imported from the entry file (index.ts), before the app loads.
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { ACTION_SNOOZE, ACTION_START, applyResponse, syncSchedule } from './notifications';
import { reloadData } from './storage';
import { applyTimerActions } from './timer';

const HANDLED: readonly string[] = [ACTION_SNOOZE, ACTION_START];

const TASK = 'quack-notification-actions';

if (Platform.OS === 'android') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
    // Snooze, and Start (the break then runs in the tray timer). A plain tap opens the app instead.
    if (error || !data || !('actionIdentifier' in data) || !HANDLED.includes(data.actionIdentifier)) {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    reloadData();
    applyTimerActions();
    applyResponse(data);
    await syncSchedule();
    return Notifications.BackgroundNotificationTaskResult.NewData;
  });
  Notifications.registerTaskAsync(TASK).catch((e) => console.warn('Could not register notification task', e));
}
