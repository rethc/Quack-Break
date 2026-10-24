import * as Notifications from 'expo-notifications';
import { NavigationBar } from 'expo-navigation-bar';
import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
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
      <NavigationBar style={dark ? 'light' : 'dark'} />
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

/** If a screen ever crashes: a way back instead of a blank screen. Booked reminders are unaffected. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: colors.bg }]}>
      <Text variant="title" center>
        Something went wrong
      </Text>
      <Text variant="body" soft center>
        Your break reminders are still on.
      </Text>
      <Button title="Try again" onPress={() => void retry()} />
    </View>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
});

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
    const handle = (r: Notifications.NotificationResponse, live: boolean) => {
      const outcome = applyResponse(r, live);
      void syncSchedule();
      // A button pressed while the app is in the background (Android) doesn't open it.
      if (outcome === 'break' && AppState.currentState !== 'background') router.navigate('/break');
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handle(last, false);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => handle(r, true));
    return () => sub.remove();
  }, []);
}
