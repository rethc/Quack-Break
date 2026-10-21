import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackIcon, IconButton } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Card, Stepper, ToggleRow } from '@/components/SettingRows';
import { Text } from '@/components/Text';
import { updateSettings } from '@/core/transitions';
import { BREAK_CHOICES, SNOOZE_CHOICES, WORK_CHOICES, type Settings } from '@/core/types';
import { haptic } from '@/services/haptics';
import {
  canNotify,
  hasExactAlarms,
  needsExactAlarmPermission,
  requestExactAlarms,
  requestNotificationPermission,
  sendTestReminder,
  syncSchedule,
} from '@/services/notifications';
import { updateData, useData } from '@/services/storage';
import { useTheme } from '@/theme';
import { formatMinuteOfDay } from '@/utils/format';

const TIME_CHOICES = Array.from({ length: 48 }, (_, i) => i * 30);

let syncTimer: ReturnType<typeof setTimeout> | undefined;
function saveSettings(patch: Partial<Settings>) {
  updateData((d) => updateSettings(d, patch));
  // Wait for the user to stop tapping before rebuilding the schedule.
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncSchedule(), 600);
}

export default function SettingsScreen() {
  const { colors } = useTheme();
  const s = useData((d) => d.settings);
  const perms = usePermissions();
  const [testSent, setTestSent] = useState(false);

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          {(c) => <BackIcon color={c} />}
        </IconButton>
        <Text variant="title">Settings</Text>
      </View>

      <Card title="Timer">
        <Stepper
          label="Work time"
          values={WORK_CHOICES}
          value={s.workMin}
          format={(v) => `${v} min`}
          onChange={(v) => saveSettings({ workMin: v })}
        />
        <Stepper
          label="Break time"
          values={BREAK_CHOICES}
          value={s.breakSec}
          format={(v) => (v >= 60 ? `${v / 60} min` : `${v} s`)}
          onChange={(v) => saveSettings({ breakSec: v })}
        />
        <Stepper
          label="Snooze"
          values={SNOOZE_CHOICES}
          value={s.snoozeMin}
          format={(v) => `${v} min`}
          onChange={(v) => saveSettings({ snoozeMin: v })}
        />
      </Card>

      <Card title="Quiet hours">
        <ToggleRow
          label="Pause reminders at night"
          value={s.quiet.enabled}
          onChange={(v) => saveSettings({ quiet: { ...s.quiet, enabled: v } })}
        />
        {s.quiet.enabled && (
          <>
            <Stepper
              label="From"
              values={TIME_CHOICES}
              value={s.quiet.startMin}
              format={formatMinuteOfDay}
              onChange={(v) => saveSettings({ quiet: { ...s.quiet, startMin: v } })}
            />
            <Stepper
              label="Until"
              values={TIME_CHOICES}
              value={s.quiet.endMin}
              format={formatMinuteOfDay}
              onChange={(v) => saveSettings({ quiet: { ...s.quiet, endMin: v } })}
            />
          </>
        )}
      </Card>

      <Card title="Sound and touch">
        <ToggleRow
          label="Quack sound"
          hint="Follows your phone's silent switch and Focus"
          value={s.sound}
          onChange={(v) => saveSettings({ sound: v })}
        />
        <ToggleRow
          label="Vibration"
          value={s.haptics}
          onChange={(v) => {
            saveSettings({ haptics: v });
            if (v) haptic.tap();
          }}
        />
      </Card>

      <Card title="Reminders">
        <PermissionRow ok={perms.notifications} label="Notifications" />
        {!perms.notifications && (
          <Button
            title="Allow notifications"
            variant="secondary"
            onPress={async () => {
              const ok = await requestNotificationPermission();
              if (!ok) await Linking.openSettings();
              perms.refresh();
            }}
          />
        )}
        {needsExactAlarmPermission && (
          <>
            <PermissionRow ok={perms.exact} label="On-time reminders (Alarms & reminders)" />
            {!perms.exact && (
              <>
                <Text variant="small" soft>
                  Without this, Android may deliver reminders late while your phone is idle.
                </Text>
                <Button title="Allow on-time reminders" variant="secondary" onPress={() => void requestExactAlarms()} />
              </>
            )}
          </>
        )}
        <Button
          title={testSent ? 'Test sent! Lock your phone 🦆' : 'Send a test reminder'}
          variant="secondary"
          disabled={!perms.notifications}
          onPress={async () => {
            await sendTestReminder(10);
            setTestSent(true);
            setTimeout(() => setTestSent(false), 10_000);
          }}
        />
        <Text variant="small" soft>
          Arrives in about 10 seconds, with the Start break and Snooze buttons.
        </Text>
      </Card>

      <Text variant="small" soft center style={{ color: colors.inkSoft }}>
        Everything stays on this phone. No account, no tracking, no ads.
      </Text>
    </Screen>
  );
}

function PermissionRow({ ok, label }: { ok: boolean; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.permRow} accessible accessibilityLabel={`${label}: ${ok ? 'allowed' : 'not allowed'}`}>
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <Text variant="label" color={ok ? colors.ok : colors.warn}>
        {ok ? '✓ Allowed' : '✕ Off'}
      </Text>
    </View>
  );
}

function usePermissions() {
  const [notifications, setNotifications] = useState(true);
  const [exact, setExact] = useState(true);
  const refresh = useCallback(() => {
    canNotify().then(setNotifications).catch(() => {});
    hasExactAlarms().then(setExact).catch(() => {});
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    // Coming back from the system settings screen.
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        refresh();
        void syncSchedule();
      }
    });
    return () => sub.remove();
  }, [refresh]);
  return { notifications, exact, refresh };
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 140 },
  permRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
});
