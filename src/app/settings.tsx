import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackIcon, IconButton } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Card, LinkRow, Stepper, ToggleRow } from '@/components/SettingRows';
import { Text } from '@/components/Text';
import { soundLabel } from '@/core/sounds';
import { BREAK_CHOICES, RULE_BREAK_SEC, RULE_WORK_MIN, SNOOZE_CHOICES, WORK_CHOICES } from '@/core/types';
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
import { saveSettings } from '@/services/settings';
import { timerAvailable } from '@/services/timer';
import { useData } from '@/services/storage';
import { useTheme } from '@/theme';
import { formatMinuteOfDay } from '@/utils/format';

const TIME_CHOICES = Array.from({ length: 48 }, (_, i) => i * 30);


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
        <ToggleRow
          label="20-20-20 rule"
          hint="A 20-second break every 20 minutes. Turn off to set your own."
          value={s.rule202020}
          onChange={(v) =>
            saveSettings(v ? { rule202020: true, workMin: RULE_WORK_MIN, breakSec: RULE_BREAK_SEC } : { rule202020: false })
          }
        />
        {!s.rule202020 && (
          <>
            <Stepper
              label="Remind me every"
              values={WORK_CHOICES}
              value={s.workMin}
              format={(v) => `${v} min`}
              onChange={(v) => saveSettings({ workMin: v })}
            />
            <Stepper
              label="Break length"
              values={BREAK_CHOICES}
              value={s.breakSec}
              format={(v) => (v >= 60 ? `${v / 60} min` : `${v} s`)}
              onChange={(v) => saveSettings({ breakSec: v })}
            />
          </>
        )}
        <Stepper
          label="Snooze for"
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

      <Card title="Sound">
        <LinkRow
          label="Break reminder"
          value={soundLabel('start', s)}
          onPress={() => router.push({ pathname: '/sound', params: { moment: 'start' } })}
        />
        <LinkRow
          label="Break over"
          value={soundLabel('end', s)}
          onPress={() => router.push({ pathname: '/sound', params: { moment: 'end' } })}
        />
      </Card>

      <Card title="Vibration">
        {/* iPhone alerts vibrate according to the phone's own settings. */}
        {Platform.OS === 'android' && (
          <>
            <ToggleRow
              label="Break reminder"
              a11yLabel="Vibrate for the break reminder"
              value={s.startVibrate}
              onChange={(v) => {
                saveSettings({ startVibrate: v });
                if (v) haptic.preview();
              }}
            />
            <ToggleRow
              label="Break over"
              a11yLabel="Vibrate when a break is over"
              value={s.endVibrate}
              onChange={(v) => {
                saveSettings({ endVibrate: v });
                if (v) haptic.preview();
              }}
            />
          </>
        )}
        <ToggleRow
          label="Button taps"
          a11yLabel="Vibrate on button taps"
          value={s.haptics}
          onChange={(v) => {
            saveSettings({ haptics: v });
            if (v) haptic.tap();
          }}
        />
      </Card>

      <Card title="Reminders">
        {timerAvailable && (
          <ToggleRow
            label="Timer in notifications"
            hint="A live countdown to your next break, with a Stop button."
            value={s.trayTimer}
            onChange={(v) => saveSettings({ trayTimer: v })}
          />
        )}
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
            <PermissionRow ok={perms.exact} label="On-time reminders" />
            {!perms.exact && (
              <>
                <Text variant="small" soft>
                  Without this, reminders can arrive late when your phone is idle.
                </Text>
                <Button title="Allow on-time reminders" variant="secondary" onPress={() => void requestExactAlarms()} />
              </>
            )}
          </>
        )}
        <Button
          title={testSent ? 'Sent. Lock your phone to see it.' : 'Send a test reminder'}
          variant="secondary"
          disabled={!perms.notifications}
          onPress={async () => {
            await sendTestReminder(10);
            setTestSent(true);
            setTimeout(() => setTestSent(false), 10_000);
          }}
        />
        <Text variant="small" soft>
          Arrives in 10 seconds.
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
