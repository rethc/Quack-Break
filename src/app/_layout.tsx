import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { completeBreakIfDone } from '@/services/breaks';
import { applyResponse, installNotificationHandler, syncSchedule } from '@/services/notifications';
import { reloadData } from '@/services/storage';
import { applyTimerActions, onTimerAction } from '@/services/timer';
import { useTheme } from '@/theme';

installNotificationHandler();

export default function RootLayout() {
  const { colors, dark } = useTheme();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  useCatchUpOnOpen();
  useNotificationTaps();

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: reduceMotion ? 'none' : 'default',
        }}
      >
        <Stack.Screen
          name="break"
          options={{ presentation: 'fullScreenModal', animation: reduceMotion ? 'none' : 'fade', gestureEnabled: false }}
        />
        <Stack.Screen name="welcome" options={{ gestureEnabled: false, animation: reduceMotion ? 'none' : 'fade' }} />
      </Stack>
    </>
  );
}

/** Each time the app comes to the front: pick up changes, count finished breaks, top up the schedule. */
function useCatchUpOnOpen() {
  useEffect(() => {
    const catchUp = () => {
      reloadData();
      applyTimerActions();
      completeBreakIfDone();
      // Old reminders in the tray are no longer useful once the app is open. This also clears
      // the timer notification, so sync afterwards to show it again.
      Notifications.dismissAllNotificationsAsync()
        .catch(() => {})
        .finally(() => void syncSchedule());
    };
    catchUp();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') catchUp();
    });
    // Stop pressed on the timer notification while the app is running.
    const offTimer = onTimerAction(() => {
      applyTimerActions();
      void syncSchedule();
    });
    return () => {
      sub.remove();
      offTimer();
    };
  }, []);
}

/** "Start break", "Snooze", or a plain tap on a notification. */
function useNotificationTaps() {
  useEffect(() => {
    const handle = (r: Notifications.NotificationResponse) => {
      const outcome = applyResponse(r);
      void syncSchedule();
      if (outcome === 'break') router.navigate('/break');
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handle(last);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
