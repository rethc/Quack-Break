import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackIcon, IconButton } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { ActionRow, Card, CardBlock, LinkRow, StatusRow, Stepper, ToggleRow } from '@/components/SettingRows';
import { Text } from '@/components/Text';
import { soundLabel } from '@/core/sounds';
import { BREAK_CHOICES, RULE_BREAK_SEC, RULE_WORK_MIN, SNOOZE_CHOICES, WORK_CHOICES } from '@/core/types';
import { haptic } from '@/services/haptics';
import { turnOnNotifications, usePermissions } from '@/hooks/usePermissions';
import { needsExactAlarmPermission, requestExactAlarms, sendTestReminder } from '@/services/notifications';
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
  const [testSent, setTestSent] = useState<'sent' | 'failed' | null>(null);

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
            saveSettings(
              v ? { rule202020: true, workMin: RULE_WORK_MIN, breakSec: RULE_BREAK_SEC } : { rule202020: false },
            )
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
            {/* From and Until can't be the same time, which would mean no quiet hours at all. */}
            <Stepper
              label="From"
              values={TIME_CHOICES.filter((t) => t !== s.quiet.endMin)}
              value={s.quiet.startMin}
              format={formatMinuteOfDay}
              onChange={(v) => saveSettings({ quiet: { ...s.quiet, startMin: v } })}
            />
            <Stepper
              label="Until"
              values={TIME_CHOICES.filter((t) => t !== s.quiet.startMin)}
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
          <CardBlock>
            <Button
              title="Allow notifications"
              variant="secondary"
              onPress={async () => {
                await turnOnNotifications();
                perms.refresh();
              }}
            />
          </CardBlock>
        )}
        {needsExactAlarmPermission && (
          <>
            <PermissionRow ok={perms.exact} label="On-time reminders" />
            {!perms.exact && (
              <CardBlock>
                <Text variant="small" soft>
                  Without this, reminders can arrive late when your phone is idle.
                </Text>
                <Button title="Allow on-time reminders" variant="secondary" onPress={() => void requestExactAlarms()} />
              </CardBlock>
            )}
          </>
        )}
        <ActionRow
          label={
            testSent === 'sent'
              ? 'Sent. Lock your phone to see it.'
              : testSent === 'failed'
                ? "Couldn't send it. Try again."
                : 'Send a test reminder'
          }
          disabled={!perms.notifications}
          onPress={async () => {
            try {
              await sendTestReminder(10);
              setTestSent('sent');
            } catch (e) {
              console.warn('Could not send the test reminder', e);
              setTestSent('failed');
            }
            setTimeout(() => setTestSent(null), 10_000);
          }}
        />
      </Card>

      <Text variant="small" soft center style={{ color: colors.inkSoft }}>
        Everything stays on this phone. No account, no tracking, no ads.
      </Text>
    </Screen>
  );
}

function PermissionRow({ ok, label }: { ok: boolean; label: string }) {
  const { colors } = useTheme();
  return <StatusRow label={label} value={ok ? '✓ Allowed' : '✕ Off'} color={ok ? colors.ok : colors.warn} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 140 },
});
