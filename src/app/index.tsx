import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Duck, ENTER_MS, type DuckMode } from '@/components/duck/Duck';
import { GearIcon, IconButton } from '@/components/Icons';
import { PondScene } from '@/components/PondScene';
import { Screen } from '@/components/Screen';
import { SpeechBubble } from '@/components/SpeechBubble';
import { Text } from '@/components/Text';
import { dueLines, pausedLines, pickFresh, quietLines, skipLines, waitingLines } from '@/core/messages';
import { dayKey, nextQuietEnd, planBreaks } from '@/core/schedule';
import { useNow } from '@/hooks/useNow';
import { beginBreak, completeBreakIfDone, resumeNow, skipNow, snoozeNow } from '@/services/breaks';
import { haptic } from '@/services/haptics';
import { useData } from '@/services/storage';
import { radius, useTheme } from '@/theme';
import { formatClock, formatCountdown, formatMinuteOfDay, nextMinuteChange, spokenCountdown } from '@/utils/format';

type Status = 'waiting' | 'due' | 'quiet' | 'break' | 'paused';

export default function Home() {
  const onboarded = useData((d) => d.onboarded);
  if (!onboarded) return <Redirect href="/welcome" />;
  return <HomeScreen />;
}

function HomeScreen() {
  const { colors } = useTheme();
  const settings = useData((d) => d.settings);
  const timer = useData((d) => d.timer);
  const days = useData((d) => d.days);

  const now = useNow((t) => {
    const p = planBreaks(t, settings, timer, { max: 1 });
    if (p.breakActive) return timer.breakEndsAt;
    if (timer.paused) return null;
    if (p.quietNow) return nextQuietEnd(t, settings.quiet);
    if (p.overdue) return null;
    return nextMinuteChange(p.dueAt, t);
  });

  const plan = planBreaks(now, settings, timer, { max: 1 });
  const status: Status = plan.breakActive
    ? 'break'
    : timer.paused
      ? 'paused'
      : plan.quietNow
        ? 'quiet'
        : plan.overdue
          ? 'due'
          : 'waiting';

  // A break that ran out while we were looking at this screen.
  useEffect(() => {
    if (timer.breakEndsAt !== null && timer.breakEndsAt <= now) completeBreakIfDone();
  }, [now, timer.breakEndsAt]);

  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setIntro(false), ENTER_MS + 200);
    return () => clearTimeout(id);
  }, []);

  // A short reaction (shrug) after Skip or Snooze, with its own line.
  const [reaction, setReaction] = useState<{ line: string } | null>(null);
  useEffect(() => {
    if (!reaction) return;
    const id = setTimeout(() => setReaction(null), 2600);
    return () => clearTimeout(id);
  }, [reaction]);

  const line = useMemo(() => {
    const lists = {
      waiting: waitingLines,
      due: dueLines,
      quiet: quietLines,
      break: ['Your break is still going!'],
      paused: pausedLines,
    };
    return pickFresh(lists[status]);
  }, [status]);

  const duckMode: DuckMode = reaction
    ? 'shrug'
    : intro
      ? 'enter'
      : ({ waiting: 'idle', due: 'attention', quiet: 'sleep', break: 'idle', paused: 'idle' } as const)[status];

  const today = days[dayKey(now)] ?? 0;
  const nextReminder = plan.reminders[0];

  const start = () => {
    haptic.tap();
    beginBreak();
    router.push('/break');
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title" style={styles.flex}>
          Quack Break
        </Text>
        <IconButton label="Settings" onPress={() => router.push('/settings')}>
          {(c) => <GearIcon color={c} />}
        </IconButton>
      </View>

      <View
        style={[styles.status, { backgroundColor: colors.card, borderBottomColor: colors.cardEdge }]}
        accessible
        accessibilityLabel={statusLabel(status, plan.dueAt - now, nextReminder, settings.quiet.endMin)}
      >
        {status === 'waiting' && (
          <>
            <Text variant="small" soft center>
              Next break in
            </Text>
            <Text variant="display" center>
              {formatCountdown(plan.dueAt - now)}
            </Text>
            <Text variant="small" soft center>
              at {formatClock(plan.dueAt)}
            </Text>
          </>
        )}
        {status === 'due' && (
          <>
            <Text variant="title" center>
              Break time
            </Text>
            <Text variant="body" soft center>
              Look at something far away for {settings.breakSec} seconds.
            </Text>
          </>
        )}
        {status === 'quiet' && (
          <>
            <Text variant="heading" center>
              Quiet hours
            </Text>
            <Text variant="body" soft center>
              {nextReminder ? `Next reminder at ${formatClock(nextReminder)}` : 'Reminders paused'}
            </Text>
          </>
        )}
        {status === 'break' && (
          <Text variant="heading" center>
            Break in progress
          </Text>
        )}
        {status === 'paused' && (
          <>
            <Text variant="heading" center>
              Reminders stopped
            </Text>
            <Text variant="body" soft center>
              Resume when you&apos;re ready.
            </Text>
          </>
        )}
      </View>

      <SpeechBubble text={reaction?.line ?? line} />

      <PondScene height={220}>
        <Duck mode={duckMode} size={150} />
      </PondScene>

      <View style={styles.actions}>
        {status === 'waiting' && <Button title="Take a break now" variant="secondary" onPress={start} />}
        {status === 'quiet' && <Button title="Take a break anyway" variant="secondary" onPress={start} />}
        {status === 'break' && <Button title="Back to my break" onPress={() => router.push('/break')} />}
        {status === 'paused' && (
          <>
            <Button
              title="Resume reminders"
              onPress={() => {
                haptic.tap();
                resumeNow();
              }}
            />
            <Button title="Take a break now" variant="secondary" onPress={start} />
          </>
        )}
        {status === 'due' && (
          <>
            <Button title="Start break" onPress={start} />
            <View style={styles.row}>
              <Button
                title={`Snooze ${settings.snoozeMin} min`}
                variant="secondary"
                style={styles.flex}
                onPress={() => {
                  haptic.soft();
                  snoozeNow();
                  setReaction({ line: `Okay, ${settings.snoozeMin} more minutes. I'll paddle nearby.` });
                }}
              />
              <Button
                title="Skip"
                variant="secondary"
                style={styles.flex}
                onPress={() => {
                  haptic.soft();
                  skipNow();
                  setReaction({ line: pickFresh(skipLines) });
                }}
              />
            </View>
          </>
        )}
      </View>

      <Text variant="small" soft center>
        {today === 0 ? 'No breaks yet today' : `${today} ${today === 1 ? 'break' : 'breaks'} today`}
      </Text>
    </Screen>
  );
}

function statusLabel(status: Status, msLeft: number, nextReminder: number | undefined, quietEndMin: number) {
  switch (status) {
    case 'waiting':
      return `Next eye break in ${spokenCountdown(msLeft)}`;
    case 'due':
      return 'Break time';
    case 'quiet':
      return nextReminder
        ? `Quiet hours. Next reminder at ${formatClock(nextReminder)}`
        : `Quiet hours until ${formatMinuteOfDay(quietEndMin)}`;
    case 'break':
      return 'Break in progress';
    case 'paused':
      return 'Reminders stopped';
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 140 },
  status: { borderRadius: radius.l, borderBottomWidth: 5, paddingVertical: 18, paddingHorizontal: 16, gap: 2 },
  actions: { gap: 12 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});
