import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { canNotify, hasExactAlarms, remindersBlocked, requestNotificationPermission } from '@/services/notifications';

/**
 * Whether reminders can reach the user: notifications allowed, the break reminder channel not
 * turned off (Android), and (Android 12+) exact alarms so they arrive on time while the phone is
 * idle. Rechecked on focus and when the user comes back from the system settings.
 */
export function usePermissions() {
  const [notifications, setNotifications] = useState(true);
  const [channel, setChannel] = useState(true);
  const [exact, setExact] = useState(true);
  const refresh = useCallback(() => {
    canNotify()
      .then(setNotifications)
      .catch(() => {});
    remindersBlocked()
      .then((blocked) => setChannel(!blocked))
      .catch(() => {});
    hasExactAlarms()
      .then(setExact)
      .catch(() => {});
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return { notifications, channel, exact, refresh };
}

/** Ask for notifications; once Android stops showing the prompt, open the app's settings instead. */
export async function turnOnNotifications() {
  try {
    const ok = await requestNotificationPermission();
    if (!ok) await Linking.openSettings();
    return ok;
  } catch (e) {
    console.warn('Could not turn on notifications', e);
    return false;
  }
}
