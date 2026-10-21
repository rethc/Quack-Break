// Android only: lets the "Snooze" button work without opening the app.
// Must be imported from the entry file (index.ts), before the app loads.
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { ACTION_SNOOZE, applyResponse, syncSchedule } from './notifications';
import { reloadData } from './storage';

const TASK = 'quack-notification-actions';

if (Platform.OS === 'android') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
    // Only Snooze is handled here. "Start break" opens the app, which handles it there.
    if (error || !data || !('actionIdentifier' in data) || data.actionIdentifier !== ACTION_SNOOZE) {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    reloadData();
    applyResponse(data);
    await syncSchedule();
    return Notifications.BackgroundNotificationTaskResult.NewData;
  });
  Notifications.registerTaskAsync(TASK).catch((e) => console.warn('Could not register notification task', e));
}
